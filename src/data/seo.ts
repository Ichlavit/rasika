export type JsonLd = Record<string, unknown>;

export type SeoPage = {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: "website" | "article";
  noindex?: boolean;
  keywords?: string[];
  topic?: string;
  jsonLd?: JsonLd[];
};

export const SITE = {
  origin: "https://www.rasika.cl",
  name: "Rasika Producciones",
  shortName: "Rasika",
  locale: "es_CL",
  language: "es-CL",
  defaultImage: "/images/blog/inmersive_learning.jpg",
  logo: "/images/svg/rasika_logo.svg",
  foundingLocation: "Santiago, Chile",
  tagline:
    "Produccion de cursos online, SCORM, LMS, tutores virtuales IA y automatizaciones EdTech para aprendizaje corporativo.",
};

export function absoluteUrl(path = "/") {
  return new URL(path, SITE.origin).toString();
}

export const VIDEO_ENHANCE_SEO = {
  name: "Chroma Key con IA Generativa: original vs. resultado",
  serviceName: "Chroma Key con IA Generativa",
  description:
    "Actores reales dan vida a la escena y la IA generativa crea locaciones, vestuario y extras para lograr producciones más ambiciosas con menos rodajes.",
  serviceDescription:
    "Producción híbrida controlada para video grabado en estudio con chroma key: conserva la actuación humana y transforma locaciones, vestuario, EPP, iluminación y extras con IA generativa.",
  servicePath: "/chroma-key-ia/",
  demoPath: "/demos/?demo=video-enhance-ia",
  pricingPath: "/pricing/#video-enhance",
  thumbnailPath: "/images/demos/video-enhance-ia.jpg",
  contentPath:
    "/videos/standalone/video_enhance_result.mp4?v=ec0150223449",
  uploadDate: "2026-07-21T17:28:05-04:00",
  duration: "PT19.33S",
} as const;

export const organizationJsonLd: JsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": absoluteUrl("/#organization"),
  name: SITE.name,
  alternateName: SITE.shortName,
  url: SITE.origin,
  logo: absoluteUrl(SITE.logo),
  description: SITE.tagline,
  foundingLocation: {
    "@type": "Place",
    name: SITE.foundingLocation,
  },
  areaServed: ["Chile", "Latinoamerica", "Global remoto"],
  knowsAbout: [
    "cursos online corporativos",
    "desarrollo SCORM",
    "diseno instruccional",
    "chatbot para tutores virtuales",
    "CourseMentor",
    "automatizaciones EdTech",
    "integracion LMS",
    "postproduccion de video con inteligencia artificial",
    "chroma key con inteligencia artificial",
    "fondos de video generados con inteligencia artificial",
    "vestuario virtual y EPP virtual",
    "TalentLMS",
    "Moodle",
    "xAPI",
  ],
};

export const websiteJsonLd: JsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": absoluteUrl("/#website"),
  name: SITE.name,
  url: SITE.origin,
  publisher: {
    "@id": absoluteUrl("/#organization"),
  },
  inLanguage: SITE.language,
};

const serviceCatalogJsonLd: JsonLd = {
  "@context": "https://schema.org",
  "@type": "Service",
  "@id": absoluteUrl("/#edtech-services"),
  name: "Produccion EdTech, cursos online y tutores IA",
  serviceType:
    "Cursos online corporativos, SCORM, videos educativos, integraciones LMS, chatbots de tutoria virtual y automatizaciones EdTech",
  provider: {
    "@id": absoluteUrl("/#organization"),
  },
  areaServed: ["Chile", "Latinoamerica", "Global remoto"],
  audience: {
    "@type": "BusinessAudience",
    audienceType:
      "Empresas, instituciones educativas, areas de capacitacion, recursos humanos, cumplimiento y transformacion digital",
  },
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "Catalogo de servicios Rasika",
    itemListElement: [
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Desarrollo de cursos online corporativos",
          description:
            "Diseno instruccional, produccion multimedia, evaluaciones y empaquetado SCORM/HTML5 para LMS.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Chatbot tutor virtual para LMS",
          description:
            "CourseMentor responde preguntas sobre el curso, acompana al alumno y captura telemetria pedagogica.",
        },
      },
      {
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: "Automatizaciones EdTech",
          description:
            "Integraciones con TalentLMS, Moodle, Supabase, xAPI, CRM y flujos de datos para aprendizaje corporativo.",
        },
      },
      {
        "@type": "Offer",
        url: absoluteUrl(VIDEO_ENHANCE_SEO.pricingPath),
        itemOffered: {
          "@type": "Service",
          name: VIDEO_ENHANCE_SEO.serviceName,
          serviceType: "Postproducción de video con inteligencia artificial",
          description: VIDEO_ENHANCE_SEO.serviceDescription,
          url: absoluteUrl(VIDEO_ENHANCE_SEO.servicePath),
        },
      },
    ],
  },
};

export const seoPages = {
  home: {
    title: "Rasika Producciones | Cursos online, SCORM, LMS e IA educativa",
    description:
      "Creamos cursos online corporativos, SCORM, videos educativos, tutores virtuales IA, integraciones LMS y automatizaciones EdTech para empresas e instituciones.",
    path: "/",
    image: "/images/blog/inmersive_learning.jpg",
    topic: "Produccion EdTech corporativa",
    keywords: [
      "cursos online corporativos",
      "desarrollo SCORM",
      "produccion e-learning",
      "chatbot tutor virtual",
      "automatizaciones EdTech",
      "integracion LMS",
    ],
    jsonLd: [serviceCatalogJsonLd],
  },
  demos: {
    title: "Demos de SCORM y Chroma Key con IA Generativa | Rasika",
    description:
      "Compara video original y Chroma Key con IA Generativa. Reemplaza locaciones, vestuario, iluminación y EPP en producciones corporativas grabadas en estudio.",
    path: "/demos/",
    image: VIDEO_ENHANCE_SEO.thumbnailPath,
    topic: "Demos de aprendizaje digital",
    keywords: [
      "demos e-learning",
      "SCORM interactivo",
      "cursos interactivos",
      "simuladores de software",
      "videos educativos corporativos",
      "postproduccion video IA",
      "chroma key inteligencia artificial",
      "reemplazo de fondo chroma key",
      "escenarios virtuales para video",
      "cambio de vestuario con IA",
      "EPP virtual",
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Demos de cursos, SCORM y Chroma Key con IA Generativa",
        about: [
          "SCORM",
          "cursos interactivos",
          "videos educativos",
          "postproduccion de video con IA",
          "chroma key",
          "fondos generados con IA",
          "vestuario virtual",
          "EPP virtual",
          "LMS",
        ],
      },
      {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        "@id": `${absoluteUrl(VIDEO_ENHANCE_SEO.demoPath)}#video`,
        name: VIDEO_ENHANCE_SEO.name,
        description: VIDEO_ENHANCE_SEO.description,
        thumbnailUrl: absoluteUrl(VIDEO_ENHANCE_SEO.thumbnailPath),
        uploadDate: VIDEO_ENHANCE_SEO.uploadDate,
        duration: VIDEO_ENHANCE_SEO.duration,
        contentUrl: absoluteUrl(VIDEO_ENHANCE_SEO.contentPath),
        url: absoluteUrl(VIDEO_ENHANCE_SEO.demoPath),
        inLanguage: SITE.language,
        publisher: {
          "@id": absoluteUrl("/#organization"),
        },
      },
    ],
  },
  videoEnhance: {
    title: "Chroma Key con IA generativa en Chile | Rasika",
    description:
      "Actores reales e IA generativa para crear locaciones, vestuario, EPP y extras sin repetir cada rodaje. Compara el resultado y revisa precios en UF.",
    path: VIDEO_ENHANCE_SEO.servicePath,
    image: VIDEO_ENHANCE_SEO.thumbnailPath,
    topic: "Producción híbrida con chroma key e IA generativa en Chile",
    keywords: [
      "chroma key con IA generativa en Chile",
      "productora audiovisual IA Santiago",
      "cambio de locaciones con IA",
      "cambio de vestuario con IA",
      "fondos animados generados por IA",
      "extras generados por IA",
      "postproduccion chroma key Chile",
      "video corporativo con IA",
      "EPP virtual",
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Service",
        "@id": `${absoluteUrl(VIDEO_ENHANCE_SEO.servicePath)}#service`,
        name: VIDEO_ENHANCE_SEO.serviceName,
        alternateName: [
          "Producción híbrida controlada",
          "Postproducción de chroma key con IA",
        ],
        serviceType:
          "Producción y postproducción audiovisual con chroma key e inteligencia artificial generativa",
        description: VIDEO_ENHANCE_SEO.serviceDescription,
        url: absoluteUrl(VIDEO_ENHANCE_SEO.servicePath),
        provider: {
          "@id": absoluteUrl("/#organization"),
        },
        areaServed: ["Santiago de Chile", "Chile", "Latinoamérica"],
        audience: {
          "@type": "BusinessAudience",
          audienceType:
            "Empresas, instituciones, equipos de capacitación, comunicaciones, marketing y prevención de riesgos",
        },
        image: absoluteUrl(VIDEO_ENHANCE_SEO.thumbnailPath),
        subjectOf: {
          "@type": "VideoObject",
          "@id": `${absoluteUrl(VIDEO_ENHANCE_SEO.demoPath)}#video`,
          name: VIDEO_ENHANCE_SEO.name,
          description: VIDEO_ENHANCE_SEO.description,
          thumbnailUrl: absoluteUrl(VIDEO_ENHANCE_SEO.thumbnailPath),
          uploadDate: VIDEO_ENHANCE_SEO.uploadDate,
          duration: VIDEO_ENHANCE_SEO.duration,
          contentUrl: absoluteUrl(VIDEO_ENHANCE_SEO.contentPath),
          url: absoluteUrl(VIDEO_ENHANCE_SEO.demoPath),
          inLanguage: SITE.language,
        },
        offers: {
          "@type": "Offer",
          url: absoluteUrl(VIDEO_ENHANCE_SEO.pricingPath),
          priceCurrency: "CLF",
          priceSpecification: [
            {
              "@type": "UnitPriceSpecification",
              price: 8,
              priceCurrency: "CLF",
              unitText: "minuto de video terminado",
              eligibleQuantity: {
                "@type": "QuantitativeValue",
                minValue: 1,
                maxValue: 5,
                unitCode: "MIN",
              },
            },
            {
              "@type": "UnitPriceSpecification",
              price: 6,
              priceCurrency: "CLF",
              unitText: "minuto de video terminado",
              eligibleQuantity: {
                "@type": "QuantitativeValue",
                minValue: 5.01,
                maxValue: 10,
                unitCode: "MIN",
              },
            },
            {
              "@type": "UnitPriceSpecification",
              price: 5,
              priceCurrency: "CLF",
              unitText: "minuto de video terminado",
              eligibleQuantity: {
                "@type": "QuantitativeValue",
                minValue: 10.01,
                maxValue: 20,
                unitCode: "MIN",
              },
            },
          ],
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "¿Pueden trabajar con un video ya grabado?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Sí. Evaluamos el material grabado con chroma key, su resolución, iluminación, encuadre y duración antes de definir el alcance de postproducción.",
            },
          },
          {
            "@type": "Question",
            name: "¿Se puede cambiar el vestuario o el EPP?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Sí. El servicio base contempla hasta dos sets de vestuario o elementos de protección personal, sujetos a evaluación técnica del movimiento y la toma.",
            },
          },
          {
            "@type": "Question",
            name: "¿Se conserva la actuación y el audio original?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Sí. La propuesta conserva a los actores, su interpretación, el guion, el idioma, la edición y el audio aprobados, salvo que se cotice un alcance adicional.",
            },
          },
          {
            "@type": "Question",
            name: "¿Cuánto cuesta el Chroma Key con IA generativa?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "La tarifa es de 8 UF por minuto para 1 a 5 minutos terminados, 6 UF por minuto para más de 5 y hasta 10 minutos, y 5 UF por minuto para más de 10 y hasta 20 minutos.",
            },
          },
          {
            "@type": "Question",
            name: "¿Trabajan con empresas fuera de Santiago?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Sí. Rasika opera desde Santiago de Chile y puede recibir material aprobado para postproducción desde otras regiones de Chile y Latinoamérica.",
            },
          },
        ],
      },
    ],
  },
  lms: {
    title: "Chatbot tutor virtual para LMS, Moodle y TalentLMS | Rasika",
    description:
      "Integramos tutores virtuales IA y automatizaciones EdTech en LMS como Moodle y TalentLMS, con RAG, Supabase, xAPI y telemetria de aprendizaje.",
    path: "/lms/",
    image: "/images/blog/tech_learning.jpg",
    topic: "CourseMentor y automatizacion LMS",
    keywords: [
      "chatbot tutor virtual",
      "tutor IA para LMS",
      "Moodle IA",
      "TalentLMS chatbot",
      "CourseMentor",
      "automatizacion LMS",
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "CourseMentor",
        applicationCategory: "EducationalApplication",
        operatingSystem: "Web, LMS",
        offers: {
          "@type": "Offer",
          category: "SaaS educativo",
        },
        provider: {
          "@id": absoluteUrl("/#organization"),
        },
      },
    ],
  },
  clients: {
    title: "Clientes y casos de e-learning corporativo | Rasika",
    description:
      "Casos y experiencias de aprendizaje digital para empresas e instituciones que necesitan cursos online, SCORM, videos, LMS y soluciones EdTech.",
    path: "/clients/",
    image: "/images/blog/dual_coding_brain.jpg",
    topic: "Casos de e-learning corporativo",
    keywords: [
      "casos e-learning",
      "clientes capacitacion online",
      "cursos corporativos",
      "SCORM empresas",
      "EdTech Chile",
    ],
  },
  pricing: {
    title: "Precios de Chroma Key con IA, cursos y SCORM | Rasika",
    description:
      "Revisa precios de Chroma Key con IA Generativa para reemplazar locaciones, vestuario, iluminación o EPP, además de cursos, SCORM y tutores virtuales.",
    path: "/pricing/",
    image: "/images/blog/making_app.png",
    topic: "Precios EdTech y e-learning",
    keywords: [
      "precio curso online",
      "cotizacion SCORM",
      "precio chatbot tutor virtual",
      "costos e-learning",
      "produccion cursos online",
      "precio postproduccion video IA",
      "precio chroma key IA",
      "precio fondos generados con IA",
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "OfferCatalog",
        name: "Modelos de inversion Rasika",
        itemListElement: [
          {
            "@type": "Offer",
            itemOffered: {
              "@type": "Service",
              name: "Cursos SCORM",
            },
          },
          {
            "@type": "Offer",
            itemOffered: {
              "@type": "Service",
              name: "Videos educativos",
            },
          },
          {
            "@type": "Offer",
            name: "Chroma Key con IA Generativa por minuto terminado",
            url: absoluteUrl(VIDEO_ENHANCE_SEO.pricingPath),
            itemOffered: {
              "@type": "Service",
              name: VIDEO_ENHANCE_SEO.serviceName,
              serviceType: "Postproducción de video con inteligencia artificial",
              description: VIDEO_ENHANCE_SEO.serviceDescription,
              provider: {
                "@id": absoluteUrl("/#organization"),
              },
            },
            priceSpecification: [
              {
                "@type": "UnitPriceSpecification",
                price: 8,
                priceCurrency: "CLF",
                unitText: "minuto de video terminado",
                eligibleQuantity: {
                  "@type": "QuantitativeValue",
                  minValue: 1,
                  maxValue: 5,
                  unitCode: "MIN",
                },
              },
              {
                "@type": "UnitPriceSpecification",
                price: 6,
                priceCurrency: "CLF",
                unitText: "minuto de video terminado",
                eligibleQuantity: {
                  "@type": "QuantitativeValue",
                  minValue: 5.01,
                  maxValue: 10,
                  unitCode: "MIN",
                },
              },
              {
                "@type": "UnitPriceSpecification",
                price: 5,
                priceCurrency: "CLF",
                unitText: "minuto de video terminado",
                eligibleQuantity: {
                  "@type": "QuantitativeValue",
                  minValue: 10.01,
                  maxValue: 20,
                  unitCode: "MIN",
                },
              },
            ],
          },
          {
            "@type": "Offer",
            itemOffered: {
              "@type": "Service",
              name: "Simuladores",
            },
          },
          {
            "@type": "Offer",
            itemOffered: {
              "@type": "SoftwareApplication",
              name: "CourseMentor SaaS",
              applicationCategory: "EducationalApplication",
            },
          },
          {
            "@type": "Offer",
            itemOffered: {
              "@type": "Service",
              name: "Integraciones LMS",
            },
          },
        ],
      },
    ],
  },
  blog: {
    title: "Blog EdTech: cursos online, IA educativa y LMS | Rasika Insights",
    description:
      "Articulos sobre e-learning, IA aplicada al aprendizaje, cursos online, SCORM, LMS, tutores virtuales y automatizaciones EdTech.",
    path: "/blog/",
    image: "/images/blog/vr_set.png",
    topic: "Blog de EdTech e IA educativa",
    keywords: [
      "blog EdTech",
      "IA educativa",
      "cursos online",
      "LMS",
      "SCORM",
      "tendencias e-learning",
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Blog",
        name: "Rasika Insights",
        about: [
          "e-learning",
          "IA educativa",
          "LMS",
          "SCORM",
          "automatizaciones EdTech",
        ],
      },
    ],
  },
  admin: {
    title: "Rasika CMS | Editor",
    description: "Panel privado de administracion de contenidos Rasika.",
    path: "/admin/",
    noindex: true,
  },
} satisfies Record<string, SeoPage>;

export const publicSeoPages = Object.values(seoPages).filter(
  (page) => !page.noindex,
);

export function webpageJsonLd(page: SeoPage): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": page.type === "article" ? "Article" : "WebPage",
    "@id": `${absoluteUrl(page.path)}#webpage`,
    url: absoluteUrl(page.path),
    name: page.title,
    description: page.description,
    inLanguage: SITE.language,
    isPartOf: {
      "@id": absoluteUrl("/#website"),
    },
    publisher: {
      "@id": absoluteUrl("/#organization"),
    },
    image: absoluteUrl(page.image || SITE.defaultImage),
    about: page.topic || SITE.tagline,
    keywords: page.keywords?.join(", "),
  };
}

export function breadcrumbJsonLd(page: SeoPage): JsonLd {
  const items = [
    {
      "@type": "ListItem",
      position: 1,
      name: "Inicio",
      item: SITE.origin,
    },
  ];

  if (page.path !== "/") {
    items.push({
      "@type": "ListItem",
      position: 2,
      name: page.title.split("|")[0].trim(),
      item: absoluteUrl(page.path),
    });
  }

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}
