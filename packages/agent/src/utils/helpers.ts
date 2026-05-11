import { execAsync } from '@robocode-packages/shared';

export const getFileTree = async (cwd: string): Promise<string> => {
  try {
    const { stdout } = await execAsync(
      `find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/.next/*" | head -80 | sort`,
      { cwd, timeout: 5_000 }
    );
    return stdout.trim();
  } catch {
    return '';
  }
};

export const getGitBranch = async (cwd: string): Promise<string | null> => {
  try {
    const { stdout } = await execAsync('git branch --show-current', { cwd, timeout: 3_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

export const detectTechStack = (pkg: Record<string, unknown> | null): string[] => {
  if (!pkg) return [];
  const deps = {
    ...((pkg.dependencies as Record<string, string>) ?? {}),
    ...((pkg.devDependencies as Record<string, string>) ?? {}),
  };

  const checks: [string | string[], string][] = [
    // languages & runtimes
    ['typescript', 'TypeScript'],
    [['ts-node', 'tsx'], 'TypeScript'],
    [['@types/node', 'node'], 'Node.js'],
    ['coffeescript', 'CoffeeScript'],
    ['reason', 'ReasonML'],
    ['elm', 'Elm'],
    ['purescript', 'PureScript'],
    ['gleam', 'Gleam'],
    ['mint', 'Mint'],

    // frontend core
    ['react', 'React'],
    ['react-dom', 'React DOM'],
    ['vue', 'Vue'],
    ['@angular/core', 'Angular'],
    ['svelte', 'Svelte'],
    ['solid-js', 'SolidJS'],
    ['preact', 'Preact'],
    ['lit', 'Lit'],
    ['lit-element', 'LitElement'],
    ['lit-html', 'lit-html'],
    ['qwik', 'Qwik'],
    ['alpinejs', 'Alpine.js'],
    ['htmx.org', 'htmx'],
    ['petite-vue', 'petite-vue'],
    ['hyperapp', 'Hyperapp'],
    ['riot', 'Riot.js'],
    ['mithril', 'Mithril'],
    ['inferno', 'Inferno'],
    ['cycle', '@cycle/run'],
    ['marko', 'Marko'],
    ['stimulus', '@hotwired/stimulus'],
    ['turbo', '@hotwired/turbo'],
    ['angular.js', 'AngularJS'],
    ['backbone', 'Backbone.js'],
    ['ember-source', 'Ember.js'],
    ['knockout', 'Knockout'],
    ['aurelia', 'Aurelia'],
    ['dojo', 'Dojo'],
    ['jquery', 'jQuery'],
    ['zepto', 'Zepto'],
    ['prototype', 'Prototype'],

    // meta frameworks
    ['next', 'Next.js'],
    ['nuxt', 'Nuxt'],
    ['@remix-run/react', 'Remix'],
    ['@sveltejs/kit', 'SvelteKit'],
    ['astro', 'Astro'],
    ['gatsby', 'Gatsby'],
    ['@nestjs/core', 'NestJS'],
    ['@analogjs/core', 'AnalogJS'],
    ['fresh', 'Fresh (Deno)'],
    ['iles', 'îles'],
    ['elderjs', 'Elder.js'],
    ['bridgetown', 'Bridgetown'],
    ['docusaurus', '@docusaurus/core'],
    ['vitepress', 'VitePress'],
    ['vuepress', 'VuePress'],
    ['hexo', 'Hexo'],
    ['eleventy', '@11ty/eleventy'],
    ['jekyll', 'Jekyll'],
    ['hugo', 'Hugo'],
    ['gridsome', 'Gridsome'],
    ['redwood', '@redwoodjs/core'],
    ['blitz', 'Blitz.js'],

    // html & templating
    ['ejs', 'EJS'],
    ['handlebars', 'Handlebars'],
    ['pug', 'Pug'],
    ['nunjucks', 'Nunjucks'],
    ['mustache', 'Mustache'],
    ['hbs', 'Handlebars'],
    ['liquidjs', 'Liquid'],
    ['eta', 'Eta'],
    ['art-template', 'art-template'],
    ['twig.js', 'Twig.js'],
    ['dot', 'doT'],
    ['squirrelly', 'Squirrelly'],
    ['jsrender', 'jsRender'],

    // css & styling
    ['tailwindcss', 'Tailwind CSS'],
    ['@emotion/react', 'Emotion'],
    ['@emotion/styled', 'Emotion Styled'],
    ['styled-components', 'Styled Components'],
    ['@vanilla-extract/css', 'Vanilla Extract'],
    ['unocss', 'UnoCSS'],
    ['sass', 'Sass'],
    ['less', 'Less'],
    ['stylus', 'Stylus'],
    ['postcss', 'PostCSS'],
    ['autoprefixer', 'Autoprefixer'],
    ['stitches', 'Stitches'],
    ['linaria', 'Linaria'],
    ['panda-css', '@pandacss/dev'],
    ['@master/css', 'Master CSS'],
    ['twind', 'Twind'],
    ['windi', 'WindiCSS'],
    ['css-modules', 'CSS Modules'],
    ['glamor', 'Glamor'],
    ['aphrodite', 'Aphrodite'],
    ['jss', 'JSS'],
    ['fela', 'Fela'],
    ['cxs', 'cxs'],
    ['goober', 'Goober'],
    ['twin.macro', 'Twin Macro'],
    ['clsx', 'clsx'],
    ['classnames', 'classnames'],

    // ui component libraries
    ['@radix-ui/react-dialog', 'Radix UI'],
    ['@shadcn/ui', 'shadcn/ui'],
    ['@mui/material', 'MUI'],
    ['antd', 'Ant Design'],
    ['@chakra-ui/react', 'Chakra UI'],
    ['mantine', 'Mantine'],
    ['daisyui', 'DaisyUI'],
    ['@headlessui/react', 'Headless UI'],
    ['@heroicons/react', 'Heroicons'],
    ['flowbite', 'Flowbite'],
    ['bootstrap', 'Bootstrap'],
    ['react-bootstrap', 'React Bootstrap'],
    ['semantic-ui-react', 'Semantic UI'],
    ['@blueprintjs/core', 'Blueprint'],
    ['primereact', 'PrimeReact'],
    ['primevue', 'PrimeVue'],
    ['primefaces', 'PrimeFaces'],
    ['vuetify', 'Vuetify'],
    ['quasar', 'Quasar'],
    ['element-plus', 'Element Plus'],
    ['naive-ui', 'Naive UI'],
    ['arco-design', 'Arco Design'],
    ['@arco-design/web-react', 'Arco Design React'],
    ['react-spectrum', '@adobe/react-spectrum'],
    ['evergreen-ui', 'Evergreen'],
    ['grommet', 'Grommet'],
    ['theme-ui', 'Theme UI'],
    ['rebass', 'Rebass'],
    ['reakit', 'Reakit'],
    ['ark-ui', '@ark-ui/react'],
    ['park-ui', 'Park UI'],
    ['nextui', '@nextui-org/react'],
    ['aceternity-ui', 'Aceternity UI'],
    ['tremor', '@tremor/react'],
    ['react-aria', 'React Aria'],
    ['kobalte', '@kobalte/core'],
    ['corvu', 'corvu'],

    // animation
    ['framer-motion', 'Framer Motion'],
    ['motion', 'Motion'],
    ['@react-spring/web', 'React Spring'],
    ['gsap', 'GSAP'],
    ['anime', 'Anime.js'],
    ['lottie-web', 'Lottie'],
    ['three', 'Three.js'],
    ['@react-three/fiber', 'React Three Fiber'],
    ['@react-three/drei', 'Drei'],
    ['babylonjs', 'Babylon.js'],
    ['pixi.js', 'PixiJS'],
    ['konva', 'Konva'],
    ['p5', 'p5.js'],
    ['d3', 'D3.js'],
    ['recharts', 'Recharts'],
    ['chart.js', 'Chart.js'],
    ['react-chartjs-2', 'React ChartJS'],
    ['visx', '@visx/visx'],
    ['nivo', '@nivo/core'],
    ['victory', 'Victory'],
    ['plotly.js', 'Plotly'],
    ['apexcharts', 'ApexCharts'],
    ['highcharts', 'Highcharts'],
    ['echarts', 'ECharts'],
    ['vega', 'Vega'],
    ['observable-plot', 'Observable Plot'],
    ['auto-animate', '@formkit/auto-animate'],
    ['popmotion', 'Popmotion'],

    // forms
    ['react-hook-form', 'React Hook Form'],
    ['formik', 'Formik'],
    ['vee-validate', 'VeeValidate'],
    ['react-final-form', 'React Final Form'],
    ['@tanstack/react-form', 'TanStack Form'],
    ['zod', 'Zod'],
    ['yup', 'Yup'],
    ['joi', 'Joi'],
    ['valibot', 'Valibot'],

    // routing
    ['react-router', 'React Router'],
    ['react-router-dom', 'React Router DOM'],
    ['@tanstack/react-router', 'TanStack Router'],
    ['wouter', 'Wouter'],
    ['reach__router', '@reach/router'],
    ['vue-router', 'Vue Router'],
    ['@angular/router', 'Angular Router'],

    // build tools
    ['vite', 'Vite'],
    ['webpack', 'Webpack'],
    ['esbuild', 'esbuild'],
    ['rollup', 'Rollup'],
    ['rolldown', 'Rolldown'],
    ['parcel', 'Parcel'],
    ['tsup', 'tsup'],
    ['@swc/core', 'SWC'],
    ['babel', '@babel/core'],
    ['bun', 'Bun'],
    ['deno', 'Deno'],
    ['rome', 'Rome'],
    ['biome', '@biomejs/biome'],

    // backend / server
    ['express', 'Express'],
    ['fastify', 'Fastify'],
    ['koa', 'Koa'],
    ['hono', 'Hono'],
    ['@hapi/hapi', 'Hapi'],
    ['restify', 'Restify'],
    ['polka', 'Polka'],
    ['h3', 'h3'],
    ['elysia', 'Elysia'],
    ['oak', 'Oak (Deno)'],
    ['feathers', '@feathersjs/feathers'],
    ['sails', 'Sails.js'],
    ['adonis', '@adonisjs/core'],
    ['loopback', '@loopback/core'],
    ['moleculer', 'Moleculer'],
    ['socket.io', 'Socket.IO'],
    ['ws', 'ws'],
    ['uWebSockets.js', 'µWebSockets'],

    // databases & ORMs
    ['prisma', 'Prisma'],
    ['drizzle-orm', 'Drizzle'],
    ['typeorm', 'TypeORM'],
    ['sequelize', 'Sequelize'],
    ['mongoose', 'Mongoose'],
    ['knex', 'Knex'],
    ['kysely', 'Kysely'],
    ['mikro-orm', '@mikro-orm/core'],
    ['objection', 'Objection.js'],
    ['bookshelf', 'Bookshelf'],
    ['waterline', 'Waterline'],
    ['pg', 'PostgreSQL'],
    ['mysql2', 'MySQL'],
    ['better-sqlite3', 'SQLite'],
    ['ioredis', 'Redis'],
    ['mongodb', 'MongoDB'],
    ['@elastic/elasticsearch', 'Elasticsearch'],
    ['cassandra-driver', 'Cassandra'],
    ['couchdb', 'CouchDB'],

    // state management
    ['zustand', 'Zustand'],
    ['jotai', 'Jotai'],
    ['recoil', 'Recoil'],
    ['mobx', 'MobX'],
    ['redux', 'Redux'],
    ['@reduxjs/toolkit', 'Redux Toolkit'],
    ['xstate', 'XState'],
    ['nanostores', 'Nanostores'],
    ['pinia', 'Pinia'],
    ['valtio', 'Valtio'],
    ['effector', 'Effector'],
    ['legend-state', '@legendapp/state'],
    ['overmind', 'Overmind'],
    ['cerebral', 'Cerebral'],
    ['storeon', 'Storeon'],
    ['hookstate', '@hookstate/core'],

    // api / data fetching
    ['axios', 'Axios'],
    ['@tanstack/react-query', 'TanStack Query'],
    ['swr', 'SWR'],
    ['@trpc/server', 'tRPC'],
    ['graphql', 'GraphQL'],
    ['@apollo/client', 'Apollo'],
    ['urql', 'urql'],
    ['openapi-fetch', 'openapi-fetch'],
    ['ky', 'Ky'],
    ['got', 'Got'],
    ['node-fetch', 'node-fetch'],
    ['undici', 'Undici'],

    // auth
    ['next-auth', 'NextAuth'],
    ['@auth/core', 'Auth.js'],
    ['passport', 'Passport'],
    ['lucia', 'Lucia'],
    ['jsonwebtoken', 'JWT'],
    ['@clerk/clerk-sdk-node', 'Clerk'],
    ['@supabase/auth-helpers-nextjs', 'Supabase Auth'],
    ['iron-session', 'Iron Session'],
    ['oslo', 'Oslo'],

    // testing
    [['vitest', 'jest'], 'Testing'],
    ['@playwright/test', 'Playwright'],
    ['cypress', 'Cypress'],
    ['puppeteer', 'Puppeteer'],
    ['@testing-library/react', 'Testing Library'],
    ['mocha', 'Mocha'],
    ['jasmine', 'Jasmine'],
    ['ava', 'AVA'],
    ['tap', 'TAP'],
    ['sinon', 'Sinon'],
    ['nock', 'Nock'],
    ['msw', 'MSW'],
    ['storybook', '@storybook/react'],

    // monorepo
    ['turbo', 'Turborepo'],
    ['nx', 'Nx'],
    ['lerna', 'Lerna'],
    ['@changesets/cli', 'Changesets'],
    ['moon', 'Moon'],
    ['rush', '@microsoft/rush-lib'],

    // ai / ml
    ['@langchain/core', 'LangChain'],
    ['@langchain/langgraph', 'LangGraph'],
    ['openai', 'OpenAI SDK'],
    ['@anthropic-ai/sdk', 'Anthropic SDK'],
    ['ai', 'Vercel AI SDK'],
    ['llamaindex', 'LlamaIndex'],
    ['@huggingface/inference', 'HuggingFace'],
    ['@google/generative-ai', 'Google Gemini'],
    ['ollama', 'Ollama'],
    ['@mistralai/mistralai', 'Mistral'],

    // mobile / desktop
    ['react-native', 'React Native'],
    ['expo', 'Expo'],
    ['electron', 'Electron'],
    ['@tauri-apps/api', 'Tauri'],
    ['@capacitor/core', 'Capacitor'],
    ['nativescript', 'NativeScript'],
    ['ionic', '@ionic/react'],

    // cli
    ['ink', 'Ink (CLI)'],
    ['commander', 'Commander'],
    ['yargs', 'Yargs'],
    ['@oclif/core', 'oclif'],
    ['inquirer', 'Inquirer'],
    ['prompts', 'Prompts'],
    ['meow', 'Meow'],
    ['cac', 'CAC'],
    ['@clack/prompts', 'Clack'],
    ['listr2', 'Listr2'],
    ['ora', 'Ora'],
    ['chalk', 'Chalk'],
    ['kleur', 'Kleur'],
    ['picocolors', 'Picocolors'],

    // runtime / infra
    ['@cloudflare/workers-types', 'Cloudflare Workers'],
    ['@aws-sdk/client-s3', 'AWS SDK'],
    ['firebase', 'Firebase'],
    ['@supabase/supabase-js', 'Supabase'],
    ['convex', 'Convex'],
    ['@planetscale/database', 'PlanetScale'],
    ['@vercel/edge', 'Vercel Edge'],
    ['@deno/kv', 'Deno KV'],
  ];

  const stack: string[] = [];

  for (const [dep, label] of checks) {
    const toCheck = Array.isArray(dep) ? dep : [dep];
    if (toCheck.some((d) => deps[d])) {
      stack.push(label);
    }
  }

  return [...new Set(stack)];
};
