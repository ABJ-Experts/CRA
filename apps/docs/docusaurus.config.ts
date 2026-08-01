import { themes as prismThemes } from 'prism-react-renderer';
import type { Config, LoadContext, Plugin } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import tailwindPostcss from '@tailwindcss/postcss';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Injects Tailwind into Docusaurus's PostCSS pipeline.
 *
 * `configurePostCss` is reduced across every plugin in registration order and
 * applied to both the client and server style pipelines.
 *
 * `base` pins Tailwind's automatic class-scan root. It defaults to
 * `process.cwd()`, which only happens to be `apps/docs` under
 * `turbo run dev --filter=docs` — not contractual. This mirrors how
 * `apps/web/app/globals.css` pins the same thing with `@source "../"`.
 */
function tailwindPlugin(context: LoadContext): Plugin {
  return {
    name: 'docusaurus-plugin-tailwindcss',
    configurePostCss(postcssOptions) {
      postcssOptions.plugins.push(tailwindPostcss({ base: context.siteDir }));
      return postcssOptions;
    },
  };
}

const config: Config = {
  title: 'CRA Docs',
  tagline: 'API documentation',
  favicon: 'img/favicon.ico',

  future: {
    // Wraps Infima, theme-classic and core CSS in `@layer docusaurus.*`,
    // leaving src/css/custom.css unlayered. Without this, Infima is unlayered
    // and beats every Tailwind utility regardless of specificity — headings,
    // links, lists, tables and code would all ignore our utilities.
    //
    // Opted into per-flag rather than `v4: true`, which would ALSO flip
    // fasterByDefault (Rspack), mdx1CompatDisabledByDefault,
    // siteStorageNamespacing and removeLegacyPostBuildHeadAttribute.
    v4: {
      useCssCascadeLayers: true,
    },
    // Mandatory companion to the above, not a performance tweak: the legacy
    // cssnano minimizer hoists @media blocks OUT of their @layer in production
    // builds only (facebook/docusaurus#11567), so dev renders correctly and
    // prod does not. Requires the @docusaurus/faster dependency.
    faster: {
      lightningCssMinimizer: true,
    },
  },

  url: 'https://your-docusaurus-site.example.com',
  baseUrl: '/',

  organizationName: 'ABJ-Experts',
  projectName: 'CRA',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  plugins: [tailwindPlugin],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          // fonts.css is kept separate and listed FIRST so Tailwind's PostCSS
          // plugin short-circuits on it (no Tailwind at-rules present) and
          // webpack resolves the bare specifiers and font url()s natively.
          customCss: ['./src/css/fonts.css', './src/css/custom.css'],
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      // Matches @repo/design-system's default (`:root { color-scheme: light dark }`).
      // With this false, an OS-dark visitor would see design-system colours in
      // dark and Infima chrome in light until hydration sets data-theme.
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'CRA Docs',
      logo: {
        alt: 'CRA Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
        { to: '/blog', label: 'Blog', position: 'left' },
        {
          href: 'https://github.com/ABJ-Experts/CRA',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Introduction',
              to: '/docs/intro',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Blog',
              to: '/blog',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/ABJ-Experts/CRA',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} CRA.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
