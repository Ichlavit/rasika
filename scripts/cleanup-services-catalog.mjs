#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ENV_FILES = [".env", ".env.local"];

const SCORM_LEVELS = [
  { key: "level_1_10_to_20_min_uf", componentKey: "scorm_10_to_20_min_uf", bundleKey: "scorm_10_to_20", price: 40 },
  { key: "level_2_20_to_40_min_uf", componentKey: "scorm_20_to_40_min_uf", bundleKey: "scorm_20_to_40", price: 80 },
  { key: "level_3_40_to_60_min_uf", componentKey: "scorm_40_to_60_min_uf", bundleKey: "scorm_40_to_60", price: 100 },
];

const VIDEO_LEVELS = [
  { key: "short_1_to_5_min_uf", componentKey: "video_1_to_5_min_uf", bundleKey: "video_1_to_5" },
  { key: "medium_5_to_10_min_uf", componentKey: "video_5_to_10_min_uf", bundleKey: "video_5_to_10" },
  { key: "long_10_to_20_min_uf", componentKey: "video_10_to_20_min_uf", bundleKey: "video_10_to_20" },
];

const SERVICE_IDS = {
  courseMentor: "f2ab2a6d-2292-47e9-9517-7f9de7b545d6",
  scormRise: "4fb10ea3-8293-4890-9120-cd9984a9f2ba",
  scormCustom: "8128db5d-c236-4f69-a15e-8b03a7d1358e",
  softwareSimulation: "d67ed392-c635-419f-b35a-149babb2a4d2",
  motion2d: "083651d6-9f56-479f-9aec-36279119aeda",
  aiBoards: "8010eada-20de-45b1-b1c4-e618a94cd8f1",
  aiUltra: "5e452688-9ad1-4857-ad71-11259886dbfa",
  presenter: "5594e6ab-917a-487a-8a1d-dca4bf12e185",
  roleplay: "994f43f1-e367-4001-b1b8-b3433754a654",
  videoEnhance: "0cabec7c-39f7-497d-bdb9-97f1e3124a14",
  marketing: "515473fb-6e6e-434c-a4b8-c33678368c42",
};

const VIDEO_PRICES = {
  [SERVICE_IDS.aiUltra]: {
    serviceName: "Video con IA Ultra-Realista",
    short_1_to_5_min_uf: 15,
    medium_5_to_10_min_uf: 20,
    long_10_to_20_min_uf: 40,
  },
  [SERVICE_IDS.aiBoards]: {
    serviceName: "Cápsulas de Video (IA + Boards)",
    short_1_to_5_min_uf: 25,
    medium_5_to_10_min_uf: 35,
    long_10_to_20_min_uf: 50,
  },
  [SERVICE_IDS.presenter]: {
    serviceName: "Video Presentador (Estudio)",
    short_1_to_5_min_uf: 25,
    medium_5_to_10_min_uf: 35,
    long_10_to_20_min_uf: 50,
  },
  [SERVICE_IDS.roleplay]: {
    serviceName: "Video Role-Playing (Estudio)",
    short_1_to_5_min_uf: 40,
    medium_5_to_10_min_uf: 60,
    long_10_to_20_min_uf: 100,
  },
  [SERVICE_IDS.videoEnhance]: {
    serviceName: "Chroma Key con IA Generativa",
    pricingModel: "rate_by_total_video_minutes",
    short_1_to_5_min_uf_per_minute: 8,
    medium_over_5_to_10_min_uf_per_minute: 6,
    long_over_10_to_20_min_uf_per_minute: 5,
  },
  [SERVICE_IDS.motion2d]: {
    serviceName: "2D Motion Graphics (Flat Design)",
    short_1_to_5_min_uf: 40,
    medium_5_to_10_min_uf: 60,
    long_10_to_20_min_uf: 80,
  },
  [SERVICE_IDS.marketing]: {
    serviceName: "Videos de Marketing de Alta Calidad",
    short_1_to_5_min_uf: 100,
    medium_5_to_10_min_uf: 150,
    long_10_to_20_min_uf: 200,
  },
};

const CONTENT = {
  scormBase: {
    inclusions: [
      "Diseño instruccional a partir de contenidos finales aprobados.",
      "Integración de activos multimedia entregados o producidos dentro del proyecto.",
      "Hotspots, navegación interactiva y controles de conocimiento.",
      "Texto alternativo (alt-text) para recursos visuales clave.",
      "Empaquetado HTML5 compatible con SCORM 1.2.",
    ],
    exclusions: [
      "Levantamiento o redacción de contenidos desde cero.",
      "Producción de videos, locuciones o piezas lineales no incluidas como componente separado.",
      "Versiones multilingües, doblajes o subtítulos adicionales.",
      "Gamificación avanzada, simuladores complejos o integraciones LMS especiales.",
    ],
  },
  scormRise: {
    inclusions: [
      "Desarrollo en Rise 360, Adobe Captivate o una estructura HTML5 estándar.",
      "Diseño instruccional a partir de contenidos finales aprobados.",
      "Integración de activos multimedia entregados o producidos dentro del proyecto.",
      "Hotspots, navegación interactiva y controles de conocimiento.",
      "Texto alternativo (alt-text) para recursos visuales clave.",
      "Empaquetado HTML5 compatible con SCORM 1.2.",
    ],
    exclusions: [
      "Levantamiento o redacción de contenidos desde cero.",
      "Producción de videos, locuciones o piezas lineales no incluidas como componente separado.",
      "Versiones multilingües, doblajes o subtítulos adicionales.",
      "Gamificación avanzada, simuladores complejos o integraciones LMS especiales.",
    ],
  },
  scormCustom: {
    inclusions: [
      "Maquetación HTML5 personalizada para navegación e interacción.",
      "Diseño instruccional a partir de contenidos finales aprobados.",
      "Integración de activos multimedia entregados o producidos dentro del proyecto.",
      "Hotspots, navegación interactiva y controles de conocimiento.",
      "Texto alternativo (alt-text) para recursos visuales clave.",
      "Empaquetado HTML5 compatible con SCORM 1.2.",
    ],
    exclusions: [
      "Levantamiento o redacción de contenidos desde cero.",
      "Producción de videos, locuciones o piezas lineales no incluidas como componente separado.",
      "Versiones multilingües, doblajes o subtítulos adicionales.",
      "Gamificación avanzada, simuladores complejos o integraciones LMS especiales.",
    ],
  },
  softwareSimulation: {
    inclusions: [
      "Diseño del flujo de práctica sobre una interfaz o proceso aprobado.",
      "Pantallas, hotspots y pasos guiados para entrenamiento procedural.",
      "Retroalimentación básica por acción o decisión del usuario.",
      "Evaluación o control de conocimiento asociado al flujo.",
      "Empaquetado HTML5 compatible con SCORM 1.2.",
    ],
    exclusions: [
      "Acceso, configuración o administración del software del cliente.",
      "Ambientes sandbox, datos de prueba o integraciones técnicas con sistemas reales.",
      "Rediseño UX/UI de la plataforma simulada.",
      "Captura de flujos no documentados o cambios posteriores al proceso aprobado.",
    ],
  },
  aiUltra: {
    inclusions: [
      "Video en alta definición con presentador o personaje generado por IA.",
      "Elementos de marca y ajustes visuales básicos dentro del estilo aprobado.",
      "Locución generada por IA sincronizada con el guion aprobado.",
      "Subtítulos opcionales en el idioma base del proyecto.",
    ],
    exclusions: [
      "Guionización o redacción de contenidos desde cero.",
      "Versiones multilingües, doblajes o subtítulos adicionales.",
      "Modelado 3D, animación avanzada o desarrollo de personajes complejos.",
      "Hosting, distribución, campañas pagadas o cargas en LMS.",
      "Formatos adicionales de aspecto o piezas derivadas no especificadas.",
    ],
  },
  aiBoards: {
    inclusions: [
      "Generación de video con IA a partir de guion aprobado.",
      "Boards de texto, íconos y apoyos visuales animados.",
      "Transiciones en motion graphics.",
      "Locución sincronizada con el contenido.",
      "Subtítulos en el idioma base del proyecto.",
    ],
    exclusions: [
      "Guionización o redacción de contenidos desde cero.",
      "Versiones multilingües, doblajes o subtítulos adicionales.",
      "Storyboard ilustrado complejo o dirección de arte fuera de la línea visual acordada.",
      "Hosting, distribución, campañas pagadas o cargas en LMS.",
      "Formatos adicionales de aspecto o piezas derivadas no especificadas.",
    ],
  },
  presenter: {
    inclusions: [
      "Presentador humano profesional grabado en estudio.",
      "Tiempo de estudio y vestuario base.",
      "Edición de video, corrección de color y postproducción.",
      "Chroma key cuando aplica al formato.",
      "Subtítulos en el idioma base del proyecto.",
    ],
    exclusions: [
      "Arte, mobiliario y utilería.",
      "Guionización o redacción de contenidos desde cero.",
      "Actores adicionales, locaciones externas o jornadas extra de grabación.",
      "Versiones multilingües, doblajes o subtítulos adicionales.",
      "Hosting, distribución, campañas pagadas o cargas en LMS.",
    ],
  },
  roleplay: {
    inclusions: [
      "Escena de role-playing grabada en estudio con hasta 2 actores.",
      "Tiempo de estudio y vestuario base.",
      "Edición de video, corrección de color y postproducción.",
      "Chroma key cuando aplica al formato.",
      "Subtítulos en el idioma base del proyecto.",
    ],
    exclusions: [
      "Arte, mobiliario y utilería.",
      "Guionización o redacción de contenidos desde cero.",
      "Actores adicionales, casting extendido, locaciones externas o jornadas extra de grabación.",
      "Versiones multilingües, doblajes o subtítulos adicionales.",
      "Hosting, distribución, campañas pagadas o cargas en LMS.",
    ],
  },
  videoEnhance: {
    inclusions: [
      "Hasta dos fondos animados realistas generados con inteligencia artificial.",
      "Hasta dos sets de vestuario o elementos de protección personal (EPP).",
      "Composición, integración visual y postproducción sobre material grabado en estudio con chroma key.",
    ],
    exclusions: [
      "Cambios de personajes.",
      "Cambios en el guion.",
      "Cambios de idioma.",
      "Efectos especiales fuera del alcance base; se cotizan por separado.",
    ],
  },
  motion2d: {
    inclusions: [
      "Storyboard a medida a partir de guion aprobado.",
      "Animación 2D en estilo flat design.",
      "Locución, música de fondo y mezcla básica.",
      "Subtítulos en el idioma base del proyecto.",
      "Adaptación visual básica a lineamientos de marca.",
    ],
    exclusions: [
      "Guionización o redacción de contenidos desde cero.",
      "Ilustración avanzada de personajes, animación 3D o rigging complejo.",
      "Versiones multilingües, doblajes o subtítulos adicionales.",
      "Hosting, distribución, campañas pagadas o cargas en LMS.",
      "Entrega de archivos fuente editables.",
    ],
  },
  marketing: {
    inclusions: [
      "Selección y edición de stock 4K premium.",
      "Locutor humano profesional.",
      "Licenciamiento de música premium para la pieza final.",
      "Edición de alto nivel, corrección de color y postproducción.",
      "Subtítulos en el idioma base del proyecto.",
    ],
    exclusions: [
      "Filmación original, locaciones, permisos o talentos presenciales.",
      "Estrategia creativa de campaña o redacción de guion desde cero.",
      "Versiones multilingües, doblajes o subtítulos adicionales.",
      "Pauta de medios, distribución, campañas pagadas o cargas en LMS.",
      "Entrega de archivos fuente editables.",
    ],
  },
  courseMentor: {
    inclusions: [
      "Asistente conversacional IA integrado en LMS compatible.",
      "RAG sobre textos, documentos y contenido SCORM según el plan contratado.",
      "RAG visual para imágenes, gráficos o videos según la cantidad de ingestas del plan.",
      "Límites mensuales de consultas por usuario para proteger el uso pedagógico.",
      "Soporte técnico IA + humano según el plan contratado.",
      "Telemetría básica de uso para seguimiento de adopción.",
    ],
    exclusions: [
      "Creación de contenidos del curso desde cero.",
      "Integraciones LMS o sistemas corporativos no validadas en el alcance inicial.",
      "Entrenamiento de modelos propietarios o fine-tuning dedicado.",
    ],
  },
};

const STANDALONE_CONTENT = {
  [SERVICE_IDS.scormRise]: CONTENT.scormRise,
  [SERVICE_IDS.scormCustom]: CONTENT.scormCustom,
  [SERVICE_IDS.softwareSimulation]: CONTENT.softwareSimulation,
  [SERVICE_IDS.aiUltra]: CONTENT.aiUltra,
  [SERVICE_IDS.aiBoards]: CONTENT.aiBoards,
  [SERVICE_IDS.presenter]: CONTENT.presenter,
  [SERVICE_IDS.roleplay]: CONTENT.roleplay,
  [SERVICE_IDS.videoEnhance]: CONTENT.videoEnhance,
  [SERVICE_IDS.motion2d]: CONTENT.motion2d,
  [SERVICE_IDS.marketing]: CONTENT.marketing,
  [SERVICE_IDS.courseMentor]: CONTENT.courseMentor,
};

const BUNDLES = [
  {
    id: "477714e2-d8aa-4ac7-ac33-d0bdf10e3e1f",
    scormId: SERVICE_IDS.scormRise,
    scormName: "SCORM/HTML en Rise",
    videoId: SERVICE_IDS.motion2d,
  },
  {
    id: "2ec6ee55-c4b9-4514-b65a-42b0d4165f7d",
    scormId: SERVICE_IDS.scormRise,
    scormName: "SCORM/HTML en Rise",
    videoId: SERVICE_IDS.aiBoards,
  },
  {
    id: "2eb1a45f-4087-44e4-8712-c036d9aa1606",
    scormId: SERVICE_IDS.scormRise,
    scormName: "SCORM/HTML en Rise",
    videoId: SERVICE_IDS.aiUltra,
  },
  {
    id: "6a3bbe26-50de-4889-a15d-045cf9ef333c",
    scormId: SERVICE_IDS.scormRise,
    scormName: "SCORM/HTML en Rise",
    videoId: SERVICE_IDS.presenter,
  },
  {
    id: "5d2b32d6-a08e-4707-8c62-4f1a6b385579",
    scormId: SERVICE_IDS.scormRise,
    scormName: "SCORM/HTML en Rise",
    videoId: SERVICE_IDS.roleplay,
  },
  {
    id: "71bde570-2d09-4892-9a20-a41d46d11e74",
    scormId: SERVICE_IDS.scormRise,
    scormName: "SCORM/HTML en Rise",
    videoId: SERVICE_IDS.marketing,
  },
  {
    id: "05abcb57-6dd1-4300-96a4-84afb4ab00b6",
    scormId: SERVICE_IDS.scormCustom,
    scormName: "SCORM/HTML personalizado",
    videoId: SERVICE_IDS.motion2d,
  },
  {
    id: "ddffd81f-8758-4d26-932b-b71c98ba8a68",
    scormId: SERVICE_IDS.scormCustom,
    scormName: "SCORM/HTML personalizado",
    videoId: SERVICE_IDS.aiBoards,
  },
  {
    id: "ca881a21-b6c1-421f-9139-d8e98f3e4ba3",
    scormId: SERVICE_IDS.scormCustom,
    scormName: "SCORM/HTML personalizado",
    videoId: SERVICE_IDS.aiUltra,
  },
  {
    id: "ef56836f-c061-4e01-9ea1-47038a50d5b6",
    scormId: SERVICE_IDS.scormCustom,
    scormName: "SCORM/HTML personalizado",
    videoId: SERVICE_IDS.presenter,
  },
  {
    id: "af0e47c9-4f12-42e0-a9ed-1f8cb4d7de09",
    scormId: SERVICE_IDS.scormCustom,
    scormName: "SCORM/HTML personalizado",
    videoId: SERVICE_IDS.roleplay,
  },
  {
    id: "4351fa43-5b17-4c5a-9ced-d09cfa240f17",
    scormId: SERVICE_IDS.scormCustom,
    scormName: "SCORM/HTML personalizado",
    videoId: SERVICE_IDS.marketing,
  },
];

function readEnv() {
  const env = { ...process.env };

  for (const filename of ENV_FILES) {
    const filePath = path.join(ROOT, filename);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;

      const [, key, rawValue] = match;
      let value = rawValue.trim();

      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      env[key] = value.replace(/\\n/g, "\n");
    }
  }

  return env;
}

function standaloneScormPricing() {
  return {
    currency: "UF",
    pricing_model: "fixed_by_navigation_minutes",
    billing_basis: "one_time_project",
    level_1_10_to_20_min_uf: 40,
    level_2_20_to_40_min_uf: 80,
    level_3_40_to_60_min_uf: 100,
  };
}

function simulationPricing() {
  return {
    ...standaloneScormPricing(),
    pricing_model: "fixed_by_simulation_navigation_minutes",
  };
}

function standaloneVideoPricing(video) {
  if (video.pricingModel === "rate_by_total_video_minutes") {
    return {
      currency: "UF",
      pricing_model: "rate_by_total_video_minutes",
      billing_basis: "one_time_project",
      short_1_to_5_min_uf_per_minute: video.short_1_to_5_min_uf_per_minute,
      medium_over_5_to_10_min_uf_per_minute: video.medium_over_5_to_10_min_uf_per_minute,
      long_over_10_to_20_min_uf_per_minute: video.long_over_10_to_20_min_uf_per_minute,
    };
  }

  return {
    currency: "UF",
    pricing_model: "fixed_by_total_video_minutes",
    billing_basis: "one_time_project",
    short_1_to_5_min_uf: video.short_1_to_5_min_uf,
    medium_5_to_10_min_uf: video.medium_5_to_10_min_uf,
    long_10_to_20_min_uf: video.long_10_to_20_min_uf,
  };
}

function courseMentorPricing() {
  return {
    currency: "CLP",
    pricing_model: "per_active_user",
    billing_options: {
      monthly: [
        {
          min_users: 1,
          max_users: 300,
          range_label: "1 a 300 usuarios activos mensuales",
          billing_basis: "user_month",
          price_per_user_clp: 3000,
        },
        {
          min_users: 301,
          max_users: 1000,
          range_label: "301 a 1000 usuarios activos mensuales",
          billing_basis: "user_month",
          price_per_user_clp: 2500,
        },
        {
          min_users: 1001,
          max_users: null,
          range_label: "1001 a 3000+ usuarios activos mensuales",
          billing_basis: "user_month",
          price_per_user_clp: 2000,
        },
      ],
      yearly: [
        {
          min_users: 1,
          max_users: 300,
          range_label: "1 a 300 usuarios activos anuales",
          billing_basis: "user_year",
          price_per_user_clp: 2400,
        },
        {
          min_users: 301,
          max_users: 1000,
          range_label: "301 a 1000 usuarios activos anuales",
          billing_basis: "user_year",
          price_per_user_clp: 2000,
        },
        {
          min_users: 1001,
          max_users: null,
          range_label: "1001 a 3000+ usuarios activos anuales",
          billing_basis: "user_year",
          price_per_user_clp: 1600,
        },
      ],
    },
    legacy_keys: {
      proyecto_monthly_clp: 3000,
      proyecto_yearly_clp: 2400,
      corporativo_monthly_clp: 2500,
      corporativo_yearly_clp: 2000,
      institucional_monthly_clp: 2000,
      institucional_yearly_clp: 1600,
    },
  };
}

function bundlePricing(bundle) {
  const video = VIDEO_PRICES[bundle.videoId];
  if (!video) throw new Error(`Missing video pricing for ${bundle.videoId}`);

  const scormComponent = {
    id: bundle.scormId,
    service_name: bundle.scormName,
  };

  for (const level of SCORM_LEVELS) {
    scormComponent[level.componentKey] = level.price;
  }

  const videoComponent = {
    id: bundle.videoId,
    service_name: video.serviceName,
  };

  for (const level of VIDEO_LEVELS) {
    videoComponent[level.componentKey] = video[level.key];
  }

  const bundleTotals = {};
  for (const scormLevel of SCORM_LEVELS) {
    for (const videoLevel of VIDEO_LEVELS) {
      bundleTotals[`${scormLevel.bundleKey}__${videoLevel.bundleKey}`] =
        scormLevel.price + video[videoLevel.key];
    }
  }

  return {
    currency: "UF",
    pricing_model: "definite_bundle_matrix",
    selection_rule:
      "Use the bundle total matching SCORM billable navigation/interactivity minutes and total video playback minutes.",
    scorm_component: scormComponent,
    video_component: videoComponent,
    bundle_totals_uf: bundleTotals,
  };
}

function bundleContent(bundle) {
  const scormContent = STANDALONE_CONTENT[bundle.scormId] || CONTENT.scormBase;
  const videoKey = Object.entries(SERVICE_IDS).find(([, value]) => value === bundle.videoId)?.[0];
  const videoContent = CONTENT[videoKey];

  if (!videoContent) {
    throw new Error(`Missing content for bundle video ${bundle.videoId}`);
  }

  return {
    inclusions: dedupe([
      "Coordinación del paquete entre módulo interactivo y activo de video.",
      "Integración del activo de video dentro del módulo interactivo.",
      ...scormContent.inclusions,
      ...videoContent.inclusions,
    ]),
    exclusions: dedupe([
      ...scormContent.exclusions,
      ...videoContent.exclusions,
      "Cambios de alcance por duración, idiomas, actores, locaciones o integraciones no aprobadas.",
    ]),
  };
}

function dedupe(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const value = String(item || "").trim();
    if (!value) continue;
    const key = value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

function expectedForService(service) {
  if (service.id === SERVICE_IDS.courseMentor) {
    return {
      pricing_tiers: courseMentorPricing(),
      ...CONTENT.courseMentor,
    };
  }

  if (service.id === SERVICE_IDS.scormRise || service.id === SERVICE_IDS.scormCustom) {
    return {
      pricing_tiers: standaloneScormPricing(),
      ...STANDALONE_CONTENT[service.id],
    };
  }

  if (service.id === SERVICE_IDS.softwareSimulation) {
    return {
      pricing_tiers: simulationPricing(),
      ...CONTENT.softwareSimulation,
    };
  }

  if (VIDEO_PRICES[service.id]) {
    const contentKey = Object.entries(SERVICE_IDS).find(([, value]) => value === service.id)?.[0];
    return {
      pricing_tiers: standaloneVideoPricing(VIDEO_PRICES[service.id]),
      ...CONTENT[contentKey],
    };
  }

  const bundle = BUNDLES.find((item) => item.id === service.id);
  if (bundle) {
    return {
      pricing_tiers: bundlePricing(bundle),
      ...bundleContent(bundle),
    };
  }

  return null;
}

function normalizeForCompare(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeForCompare);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeForCompare(value[key]);
        return acc;
      }, {});
  }

  return value;
}

function sameJson(a, b) {
  return JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b));
}

function valueAt(obj, pathParts) {
  return pathParts.reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function pathDiffs(current, expected, paths) {
  return paths.filter((pathValue) => {
    const parts = pathValue.split(".");
    return !sameJson(valueAt(current, parts), valueAt(expected, parts));
  });
}

function analyzeRow(service) {
  const expected = expectedForService(service);
  if (!expected) {
    return {
      service,
      expected: null,
      unknown: true,
      changed: false,
      changedFields: [],
      pricePathsChanged: [],
      bundleTotalsChanged: false,
    };
  }

  const changedFields = ["pricing_tiers", "inclusions", "exclusions"].filter(
    (field) => !sameJson(service[field], expected[field]),
  );

  let pricePaths = [];
  if (service.category === "bundle") {
    pricePaths = pathDiffs(service, expected, [
      "pricing_tiers.scorm_component",
      "pricing_tiers.video_component",
      "pricing_tiers.bundle_totals_uf",
    ]);
  } else if (service.id === SERVICE_IDS.courseMentor) {
    pricePaths = pathDiffs(service, expected, [
      "pricing_tiers.billing_options",
      "pricing_tiers.legacy_keys",
    ]);
  } else if (VIDEO_PRICES[service.id]) {
    const video = VIDEO_PRICES[service.id];
    const videoPricePaths = video.pricingModel === "rate_by_total_video_minutes"
      ? [
          "pricing_tiers.short_1_to_5_min_uf_per_minute",
          "pricing_tiers.medium_over_5_to_10_min_uf_per_minute",
          "pricing_tiers.long_over_10_to_20_min_uf_per_minute",
        ]
      : VIDEO_LEVELS.map((level) => `pricing_tiers.${level.key}`);
    pricePaths = pathDiffs(service, expected, videoPricePaths);
  } else {
    pricePaths = pathDiffs(service, expected, SCORM_LEVELS.map((level) => `pricing_tiers.${level.key}`));
  }

  return {
    service,
    expected,
    unknown: false,
    changed: changedFields.length > 0,
    changedFields,
    pricePathsChanged: pricePaths,
    bundleTotalsChanged: pricePaths.includes("pricing_tiers.bundle_totals_uf"),
  };
}

async function supabaseFetch(env, endpoint, options = {}) {
  const supabaseUrl = (env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL or PUBLIC_SUPABASE_URL.");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");

  const response = await fetch(`${supabaseUrl}${endpoint}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${text}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function fetchServices(env) {
  return supabaseFetch(
    env,
    "/rest/v1/services?select=id,service_name,category,pricing_tiers,inclusions,exclusions&order=category.asc,service_name.asc",
  );
}

async function applyUpdate(env, analysis) {
  const { service, expected } = analysis;
  await supabaseFetch(env, `/rest/v1/services?id=eq.${encodeURIComponent(service.id)}`, {
    method: "PATCH",
    headers: {
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      pricing_tiers: expected.pricing_tiers,
      inclusions: expected.inclusions,
      exclusions: expected.exclusions,
    }),
  });
}

function printSummary(rows, analyses) {
  const unknown = analyses.filter((item) => item.unknown);
  const changed = analyses.filter((item) => item.changed);
  const priceChanged = analyses.filter((item) => item.pricePathsChanged.length > 0);
  const bundleTotalsChanged = analyses.filter((item) => item.bundleTotalsChanged);
  const contentChanged = analyses.filter((item) =>
    item.changedFields.includes("inclusions") || item.changedFields.includes("exclusions"),
  );

  console.log(`Services fetched: ${rows.length}`);
  console.log(`Catalog rows covered by cleanup: ${analyses.length - unknown.length}`);
  console.log(`Rows needing updates: ${changed.length}`);
  console.log(`Rows with price-key changes: ${priceChanged.length}`);
  console.log(`Bundle rows with total changes: ${bundleTotalsChanged.length}`);
  console.log(`Rows with inclusion/exclusion changes: ${contentChanged.length}`);

  if (unknown.length > 0) {
    console.log("\nUncovered services:");
    for (const item of unknown) {
      console.log(`- ${item.service.service_name} (${item.service.id})`);
    }
  }

  if (changed.length > 0) {
    console.log("\nPlanned updates:");
    for (const item of changed) {
      const fields = item.changedFields.join(", ");
      const priceFields = item.pricePathsChanged.length > 0 ? ` | price paths: ${item.pricePathsChanged.join(", ")}` : "";
      console.log(`- ${item.service.service_name}: ${fields}${priceFields}`);
    }
  }
}

async function main() {
  const mode = process.argv.includes("--apply") ? "apply" : "dry-run";
  const env = readEnv();
  const rows = await fetchServices(env);
  const analyses = rows.map(analyzeRow);

  printSummary(rows, analyses);

  const changed = analyses.filter((item) => item.changed && !item.unknown);

  if (mode === "dry-run") {
    console.log("\nDry-run only. Re-run with --apply to update Supabase.");
    return;
  }

  for (const item of changed) {
    await applyUpdate(env, item);
    console.log(`Updated: ${item.service.service_name}`);
  }

  const verifiedRows = await fetchServices(env);
  const remaining = verifiedRows.map(analyzeRow).filter((item) => item.changed && !item.unknown);

  console.log(`\nVerification remaining updates: ${remaining.length}`);
  if (remaining.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
