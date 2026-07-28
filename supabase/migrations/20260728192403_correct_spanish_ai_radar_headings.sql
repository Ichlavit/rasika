update public.blog_posts
set content_html = replace(
  content_html,
  '<h2>Por que importa</h2>',
  '<h2>Por qué importa</h2>'
)
where content_html like '%<h2>Por que importa</h2>%';
