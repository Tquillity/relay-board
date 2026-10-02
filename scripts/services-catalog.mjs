// The providers the services scanner (scan-services.mjs) can recognise. Each entry says what to look for:
//   packages: dependency names; a trailing "*" makes it a prefix (npm, PyPI, crates.io and Go module paths)
//   env:      regular expressions matched against environment variable NAMES
//   files:    config file paths; a pattern without "/" matches that file name at any depth, "*" matches within one segment
// Signals that don't identify a provider on their own (DATABASE_URL, API_KEY, ...) are deliberately absent.

const ENV_PREFIX = "(?:NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|EXPO_PUBLIC_|NUXT_PUBLIC_)?";
const env = (pattern) => new RegExp(`^${ENV_PREFIX}(?:${pattern})`);

export const CATALOG = [
  // Payments
  { id: "stripe", name: "Stripe", category: "payments", purpose: "Card payments", dashboardUrl: "https://dashboard.stripe.com",
    packages: ["stripe", "@stripe/*", "stripe-python", "async-stripe", "github.com/stripe/stripe-go/*"], env: [env("STRIPE_")] },
  { id: "klarna", name: "Klarna", category: "payments", purpose: "Pay later and invoice payments", dashboardUrl: "https://portal.klarna.com",
    packages: ["@klarna/*", "klarna-payments"], env: [env("KLARNA_")] },
  { id: "swish", name: "Swish", category: "payments", purpose: "Swedish mobile payments", dashboardUrl: "https://www.swish.nu",
    packages: ["swish-payments", "@swish/*"], env: [env("SWISH_")] },
  { id: "paypal", name: "PayPal", category: "payments", purpose: "PayPal payments", dashboardUrl: "https://www.paypal.com/businessmanage",
    packages: ["@paypal/*", "paypal-rest-sdk", "paypalrestsdk", "paypalcheckoutsdk"], env: [env("PAYPAL_")] },
  { id: "adyen", name: "Adyen", category: "payments", purpose: "Payments", dashboardUrl: "https://ca-live.adyen.com",
    packages: ["@adyen/*", "adyen"], env: [env("ADYEN_")] },

  // Hosting
  { id: "vercel", name: "Vercel", category: "hosting", purpose: "Hosting and deploys", dashboardUrl: "https://vercel.com/dashboard",
    packages: ["@vercel/*", "vercel"], env: [env("VERCEL_")], files: ["vercel.json"] },
  { id: "netlify", name: "Netlify", category: "hosting", purpose: "Hosting and deploys", dashboardUrl: "https://app.netlify.com",
    packages: ["@netlify/*", "netlify-cli"], env: [env("NETLIFY_")], files: ["netlify.toml"] },
  { id: "cloudflare", name: "Cloudflare", category: "hosting", purpose: "Workers, Pages and DNS", dashboardUrl: "https://dash.cloudflare.com",
    packages: ["wrangler", "miniflare", "@cloudflare/*"], env: [env("CLOUDFLARE_")], files: ["wrangler.toml", "wrangler.json", "wrangler.jsonc"] },
  { id: "render", name: "Render", category: "hosting", purpose: "Hosting and deploys", dashboardUrl: "https://dashboard.render.com",
    env: [env("RENDER_")], files: ["render.yaml"] },
  { id: "fly-io", name: "Fly.io", category: "hosting", purpose: "Hosting and deploys", dashboardUrl: "https://fly.io/dashboard",
    env: [env("FLY_")], files: ["fly.toml"] },
  { id: "railway", name: "Railway", category: "hosting", purpose: "Hosting and deploys", dashboardUrl: "https://railway.app/dashboard",
    packages: ["@railway/*"], env: [env("RAILWAY_")], files: ["railway.json", "railway.toml"] },
  { id: "heroku", name: "Heroku", category: "hosting", purpose: "Hosting and deploys", dashboardUrl: "https://dashboard.heroku.com",
    env: [env("HEROKU_")], files: ["Procfile", "heroku.yml"] },
  { id: "aws", name: "AWS", category: "hosting", purpose: "Amazon Web Services", dashboardUrl: "https://console.aws.amazon.com",
    packages: ["aws-sdk", "aws-cdk", "aws-cdk-lib", "aws-amplify", "@aws-amplify/*", "boto3", "botocore", "@aws-sdk/client-lambda",
      "@aws-sdk/client-dynamodb", "@aws-sdk/client-sqs", "@aws-sdk/client-sns"],
    env: [env("AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|REGION|DEFAULT_REGION)$")],
    files: ["samconfig.toml", "serverless.yml", "amplify.yml", "cdk.json"] },
  { id: "google-cloud", name: "Google Cloud / Firebase", category: "hosting", purpose: "Google Cloud and Firebase", dashboardUrl: "https://console.cloud.google.com",
    packages: ["firebase", "firebase-admin", "firebase-tools", "@firebase/*", "@google-cloud/*", "google-cloud-*", "cloud.google.com/go/*"],
    env: [env("FIREBASE_"), env("GOOGLE_CLOUD_"), env("GCP_"), env("GOOGLE_APPLICATION_CREDENTIALS$")],
    files: ["firebase.json", ".firebaserc"] },
  { id: "azure", name: "Microsoft Azure", category: "hosting", purpose: "Azure cloud services", dashboardUrl: "https://portal.azure.com",
    packages: ["@azure/*", "azure-*"], env: [env("AZURE_")], files: ["azure.yaml", "azure-pipelines.yml"] },

  // Databases
  { id: "supabase", name: "Supabase", category: "database", purpose: "Postgres database, auth and storage", dashboardUrl: "https://supabase.com/dashboard",
    packages: ["@supabase/*", "supabase"], env: [env("SUPABASE_")], files: ["supabase/config.toml"] },
  { id: "neon", name: "Neon", category: "database", purpose: "Serverless Postgres", dashboardUrl: "https://console.neon.tech",
    packages: ["@neondatabase/*"], env: [env("NEON_")] },
  { id: "planetscale", name: "PlanetScale", category: "database", purpose: "Managed MySQL", dashboardUrl: "https://app.planetscale.com",
    packages: ["@planetscale/*"], env: [env("PLANETSCALE_")] },
  { id: "mongodb-atlas", name: "MongoDB Atlas", category: "database", purpose: "Document database", dashboardUrl: "https://cloud.mongodb.com",
    packages: ["mongodb", "mongoose", "pymongo", "motor"], env: [env("MONGO(?:DB)?_")] },
  { id: "upstash", name: "Upstash", category: "database", purpose: "Serverless Redis and queues", dashboardUrl: "https://console.upstash.com",
    packages: ["@upstash/*", "upstash-redis"], env: [env("UPSTASH_")] },
  { id: "redis", name: "Redis", category: "database", purpose: "Cache and queues", dashboardUrl: "https://app.redislabs.com",
    packages: ["redis", "ioredis", "@redis/*"], env: [env("REDIS_")] },
  { id: "turso", name: "Turso", category: "database", purpose: "Edge SQLite", dashboardUrl: "https://turso.tech/app",
    packages: ["@libsql/*", "@tursodatabase/*", "libsql-client"], env: [env("TURSO_"), env("LIBSQL_")] },

  // Email
  { id: "resend", name: "Resend", category: "email", purpose: "Transactional email", dashboardUrl: "https://resend.com/overview",
    packages: ["resend"], env: [env("RESEND_")] },
  { id: "sendgrid", name: "SendGrid", category: "email", purpose: "Transactional email", dashboardUrl: "https://app.sendgrid.com",
    packages: ["@sendgrid/*", "sendgrid"], env: [env("SENDGRID_")] },
  { id: "postmark", name: "Postmark", category: "email", purpose: "Transactional email", dashboardUrl: "https://account.postmarkapp.com",
    packages: ["postmark", "postmarker"], env: [env("POSTMARK_")] },
  { id: "mailgun", name: "Mailgun", category: "email", purpose: "Transactional email", dashboardUrl: "https://app.mailgun.com",
    packages: ["mailgun.js", "mailgun-js", "mailgun"], env: [env("MAILGUN_")] },
  { id: "aws-ses", name: "AWS SES", category: "email", purpose: "Transactional email", dashboardUrl: "https://console.aws.amazon.com/ses",
    packages: ["@aws-sdk/client-ses", "@aws-sdk/client-sesv2"], env: [env("(?:AWS_)?SES_")] },

  // Monitoring
  { id: "sentry", name: "Sentry", category: "monitoring", purpose: "Error tracking", dashboardUrl: "https://sentry.io",
    packages: ["@sentry/*", "sentry-sdk", "sentry"], env: [env("SENTRY_")] },
  { id: "datadog", name: "Datadog", category: "monitoring", purpose: "Metrics, logs and tracing", dashboardUrl: "https://app.datadoghq.com",
    packages: ["dd-trace", "@datadog/*", "datadog", "ddtrace"], env: [env("DD_"), env("DATADOG_")] },
  { id: "better-stack", name: "Better Stack", category: "monitoring", purpose: "Logs and uptime monitoring", dashboardUrl: "https://betterstack.com",
    packages: ["@logtail/*", "logtail"], env: [env("LOGTAIL_"), env("BETTERSTACK_"), env("BETTER_STACK_")] },

  // Analytics
  { id: "posthog", name: "PostHog", category: "analytics", purpose: "Product analytics", dashboardUrl: "https://app.posthog.com",
    packages: ["posthog-js", "posthog-node", "posthog"], env: [env("POSTHOG_")] },
  { id: "plausible", name: "Plausible", category: "analytics", purpose: "Web analytics", dashboardUrl: "https://plausible.io/sites",
    packages: ["plausible-tracker", "next-plausible"], env: [env("PLAUSIBLE_")] },
  { id: "google-analytics", name: "Google Analytics", category: "analytics", purpose: "Web analytics", dashboardUrl: "https://analytics.google.com",
    packages: ["react-ga", "react-ga4", "ga-gtag"], env: [env("GA_MEASUREMENT_ID$"), env("GA_TRACKING_ID$"), env("GOOGLE_ANALYTICS")] },
  { id: "mixpanel", name: "Mixpanel", category: "analytics", purpose: "Product analytics", dashboardUrl: "https://mixpanel.com/report",
    packages: ["mixpanel", "mixpanel-browser", "@mixpanel/*"], env: [env("MIXPANEL_")] },

  // AI
  { id: "openai", name: "OpenAI", category: "ai", purpose: "Language and image models", dashboardUrl: "https://platform.openai.com",
    packages: ["openai"], env: [env("OPENAI_")] },
  { id: "anthropic", name: "Anthropic", category: "ai", purpose: "Claude models", dashboardUrl: "https://console.anthropic.com",
    packages: ["@anthropic-ai/*", "anthropic"], env: [env("ANTHROPIC_")] },
  { id: "replicate", name: "Replicate", category: "ai", purpose: "Hosted machine learning models", dashboardUrl: "https://replicate.com/account",
    packages: ["replicate"], env: [env("REPLICATE_")] },
  { id: "google-gemini", name: "Google Gemini", category: "ai", purpose: "Gemini models", dashboardUrl: "https://aistudio.google.com",
    packages: ["@google/generative-ai", "@google/genai", "google-generativeai", "google-genai"],
    env: [env("GEMINI_"), env("GOOGLE_GENERATIVE_AI_")] },

  // Auth
  { id: "clerk", name: "Clerk", category: "auth", purpose: "User sign-in", dashboardUrl: "https://dashboard.clerk.com",
    packages: ["@clerk/*", "clerk-sdk-python"], env: [env("CLERK_")] },
  { id: "auth0", name: "Auth0", category: "auth", purpose: "User sign-in", dashboardUrl: "https://manage.auth0.com",
    packages: ["@auth0/*", "auth0", "auth0-python"], env: [env("AUTH0_")] },

  // Storage and media
  { id: "cloudinary", name: "Cloudinary", category: "media", purpose: "Image and video hosting", dashboardUrl: "https://console.cloudinary.com",
    packages: ["cloudinary", "next-cloudinary", "@cloudinary/*"], env: [env("CLOUDINARY_")] },
  { id: "uploadthing", name: "UploadThing", category: "storage", purpose: "File uploads", dashboardUrl: "https://uploadthing.com/dashboard",
    packages: ["uploadthing", "@uploadthing/*"], env: [env("UPLOADTHING_")] },
  { id: "aws-s3", name: "AWS S3", category: "storage", purpose: "File storage", dashboardUrl: "https://console.aws.amazon.com/s3",
    packages: ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"], env: [env("(?:AWS_)?S3_")] },
  { id: "mux", name: "Mux", category: "media", purpose: "Video hosting and streaming", dashboardUrl: "https://dashboard.mux.com",
    packages: ["@mux/*", "mux-python"], env: [env("MUX_")] },

  // Search
  { id: "algolia", name: "Algolia", category: "search", purpose: "Hosted search", dashboardUrl: "https://dashboard.algolia.com",
    packages: ["algoliasearch", "@algolia/*", "github.com/algolia/algoliasearch-client-go/*", "react-instantsearch", "instantsearch.js"], env: [env("ALGOLIA_")] },
  { id: "meilisearch", name: "Meilisearch", category: "search", purpose: "Search engine", dashboardUrl: "https://cloud.meilisearch.com",
    packages: ["meilisearch", "@meilisearch/*"], env: [env("MEILI")] },

  // Messaging
  { id: "twilio", name: "Twilio", category: "messaging", purpose: "SMS and voice", dashboardUrl: "https://console.twilio.com",
    packages: ["twilio"], env: [env("TWILIO_")] },
  { id: "pusher", name: "Pusher", category: "messaging", purpose: "Realtime messaging", dashboardUrl: "https://dashboard.pusher.com",
    packages: ["pusher", "pusher-js", "@pusher/*"], env: [env("PUSHER_")] },
  { id: "ably", name: "Ably", category: "messaging", purpose: "Realtime messaging", dashboardUrl: "https://ably.com/accounts",
    packages: ["ably", "@ably/*"], env: [env("ABLY_")] },

  // Maps
  { id: "google-maps", name: "Google Maps", category: "maps", purpose: "Maps and geocoding", dashboardUrl: "https://console.cloud.google.com/google/maps-apis",
    packages: ["@googlemaps/*", "@react-google-maps/api", "google-map-react", "googlemaps"], env: [env("GOOGLE_MAPS"), env("GMAPS_")] },
  { id: "mapbox", name: "Mapbox", category: "maps", purpose: "Maps and geocoding", dashboardUrl: "https://account.mapbox.com",
    packages: ["mapbox-gl", "@mapbox/*", "react-map-gl", "mapbox"], env: [env("MAPBOX_")] },

  // Captcha
  { id: "hcaptcha", name: "hCaptcha", category: "captcha", purpose: "Bot protection", dashboardUrl: "https://dashboard.hcaptcha.com",
    packages: ["@hcaptcha/*", "hcaptcha"], env: [env("HCAPTCHA_")] },
  { id: "recaptcha", name: "reCAPTCHA", category: "captcha", purpose: "Bot protection", dashboardUrl: "https://www.google.com/recaptcha/admin",
    packages: ["react-google-recaptcha", "react-google-recaptcha-v3", "recaptcha", "google-recaptcha"], env: [env("RECAPTCHA_")] },
  { id: "turnstile", name: "Cloudflare Turnstile", category: "captcha", purpose: "Bot protection", dashboardUrl: "https://dash.cloudflare.com/?to=/:account/turnstile",
    packages: ["@marsidev/react-turnstile", "@cloudflare/turnstile"], env: [env("TURNSTILE_")] },

  // CMS
  { id: "sanity", name: "Sanity", category: "cms", purpose: "Headless CMS", dashboardUrl: "https://www.sanity.io/manage",
    packages: ["sanity", "next-sanity", "@sanity/*"], env: [env("SANITY_")] },
  { id: "contentful", name: "Contentful", category: "cms", purpose: "Headless CMS", dashboardUrl: "https://app.contentful.com",
    packages: ["contentful", "contentful-management", "@contentful/*"], env: [env("CONTENTFUL_")] },

  // CI and mobile builds
  { id: "github-actions", name: "GitHub Actions", category: "ci", purpose: "Continuous integration", dashboardUrl: "https://github.com/settings/billing",
    files: [".github/workflows/*"] },
  { id: "expo-eas", name: "Expo / EAS", category: "other", purpose: "Mobile app builds", dashboardUrl: "https://expo.dev",
    packages: ["expo", "@expo/*", "eas-cli"], env: [env("EXPO_TOKEN$")], files: ["eas.json"] },
];
