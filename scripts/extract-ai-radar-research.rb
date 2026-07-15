#!/usr/bin/env ruby

require "json"
require "open3"
require "rexml/document"
require "rexml/xpath"

SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RELATIONSHIP_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

def read_zip_entry(workbook_path, entry_path)
  output, error, status = Open3.capture3("unzip", "-p", workbook_path, entry_path)
  raise "Unable to read #{entry_path}: #{error}" unless status.success?

  output
end

def cell_column_index(reference)
  letters = reference.to_s[/\A[A-Z]+/]
  return nil unless letters

  letters.each_byte.reduce(0) { |value, byte| (value * 26) + byte - 64 } - 1
end

def shared_strings(workbook_path)
  document = REXML::Document.new(read_zip_entry(workbook_path, "xl/sharedStrings.xml"))
  namespaces = { "x" => SPREADSHEET_NS }

  REXML::XPath.match(document, "//x:si", namespaces).map do |item|
    REXML::XPath.match(item, ".//x:t", namespaces).map(&:text).join
  end
rescue RuntimeError
  []
end

def worksheet_entries(workbook_path)
  workbook = REXML::Document.new(read_zip_entry(workbook_path, "xl/workbook.xml"))
  relationships = REXML::Document.new(
    read_zip_entry(workbook_path, "xl/_rels/workbook.xml.rels")
  )
  workbook_namespaces = { "x" => SPREADSHEET_NS, "r" => OFFICE_REL_NS }
  relationship_namespaces = { "r" => RELATIONSHIP_NS }

  targets = {}
  REXML::XPath.each(relationships, "//r:Relationship", relationship_namespaces) do |relationship|
    target = relationship.attributes["Target"].to_s.sub(%r{\A/}, "")
    targets[relationship.attributes["Id"]] = target
  end

  REXML::XPath.match(workbook, "//x:sheet", workbook_namespaces).map do |sheet|
    relationship_id = sheet.attributes.get_attribute_ns(OFFICE_REL_NS, "id")&.value
    [sheet.attributes["name"], targets.fetch(relationship_id)]
  end
end

def worksheet_rows(workbook_path, entry_path, strings)
  document = REXML::Document.new(read_zip_entry(workbook_path, entry_path))
  namespaces = { "x" => SPREADSHEET_NS }

  rows = REXML::XPath.match(document, "//x:sheetData/x:row", namespaces).map do |row|
    values = []

    REXML::XPath.each(row, "x:c", namespaces) do |cell|
      column_index = cell_column_index(cell.attributes["r"])
      next if column_index.nil?

      type = cell.attributes["t"]
      raw_value = REXML::XPath.first(cell, "x:v", namespaces)&.text
      value = case type
              when "s"
                strings[raw_value.to_i]
              when "inlineStr"
                REXML::XPath.match(cell, ".//x:t", namespaces).map(&:text).join
              else
                raw_value
              end
      values[column_index] = value
    end

    values
  end

  headers = rows.shift.to_a.map { |value| value.to_s.strip }
  rows.map do |values|
    next if values.compact.all? { |value| value.to_s.strip.empty? }

    headers.each_with_index.to_h do |header, index|
      [header, values[index]]
    end
  end.compact
end

workbook_path = ARGV[0]
output_path = ARGV[1]

abort "Usage: #{$PROGRAM_NAME} INPUT.xlsx [OUTPUT.json]" unless workbook_path
abort "Workbook not found: #{workbook_path}" unless File.file?(workbook_path)

strings = shared_strings(workbook_path)
sheets = worksheet_entries(workbook_path).to_h do |name, entry_path|
  [name, worksheet_rows(workbook_path, entry_path, strings)]
end

result = {
  "source_workbook" => File.basename(workbook_path),
  "sheet_counts" => sheets.transform_values(&:length),
  "sheets" => sheets
}
json = JSON.pretty_generate(result)

if output_path
  File.write(output_path, json)
else
  puts json
end
