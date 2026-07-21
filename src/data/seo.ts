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
    title: "Demos de cursos, SCORM y video con IA | Rasika",
    description:
      "Explora cursos interactivos, SCORM, simuladores y videos educativos con postproduccion IA, fondos generativos y chroma key desarrollados por Rasika.",
    path: "/demos/",
    image: "/images/blog/tech_learning.jpg",
    topic: "Demos de aprendizaje digital",
    keywords: [
      "demos e-learning",
      "SCORM interactivo",
      "cursos interactivos",
      "simuladores de software",
      "videos educativos corporativos",
      "postproduccion video IA",
      "chroma key inteligencia artificial",
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Demos de cursos, SCORM y video con IA",
        about: ["SCORM", "cursos interactivos", "videos educativos", "video con IA", "chroma key", "LMS"],
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
    title: "Precios de cursos, SCORM, video IA y tutores | Rasika",
    description:
      "Revisa precios para producir cursos, SCORM, videos educativos, postproduccion con IA, simuladores, tutores virtuales e integraciones LMS.",
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
