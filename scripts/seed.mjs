/**
 * Creates the indexes the app relies on and — with --demo — inserts a handful
 * of sample quotes so the feed isn't empty on a fresh database.
 *
 *   node --env-file=.env.local scripts/seed.mjs
 *   node --env-file=.env.local scripts/seed.mjs --demo
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB ?? "zitutim";

if (!uri) {
  console.error("MONGODB_URI is not set. Run with --env-file=.env.local");
  process.exit(1);
}

const DEMO = [
  {
    text: "אם זה עובד בסביבה המקומית שלי, זו כבר בעיה של הפרודקשן",
    author: "דנה",
    saidAt: "2026-06-11",
    context: "בסטנדאפ, אחרי שהדיפלוי נפל בפעם השלישית",
    addedBy: "יואל",
  },
  {
    text: "בואו נדחה את זה לספרינט הבא, ואז נדחה את זה שוב",
    author: "עומר",
    saidAt: "2026-06-24",
    context: "בתכנון ספרינט",
    addedBy: "דנה",
  },
  {
    text: "אין דבר קבוע יותר מפיצ׳ר זמני",
    author: "נועה",
    saidAt: "2026-07-02",
    context: null,
    addedBy: "עומר",
  },
  {
    text: "הקוד הזה נכתב על ידי שניים: אני, ואלוהים. עכשיו רק אלוהים מבין אותו",
    author: "איתי",
    saidAt: "2026-07-15",
    context: "בזמן קוד רוויו",
    addedBy: "נועה",
  },
  {
    text: "תמיד יש זמן לעוד קפה אחד",
    author: "דנה",
    saidAt: "2026-07-28",
    context: "16:40, לפני הריטרו",
    addedBy: "איתי",
  },
];

const client = new MongoClient(uri);

try {
  await client.connect();
  const quotes = client.db(dbName).collection("quotes");

  await quotes.createIndexes([
    { key: { createdAt: -1 } },
    { key: { saidAt: -1 } },
    { key: { author: 1 } },
  ]);
  console.log(`Indexes ready on ${dbName}.quotes`);

  if (process.argv.includes("--demo")) {
    const existing = await quotes.countDocuments();
    if (existing > 0) {
      console.log(`Skipping demo data — ${existing} quotes already present.`);
    } else {
      const now = new Date();
      await quotes.insertMany(
        DEMO.map((quote, index) => ({
          ...quote,
          saidAt: new Date(quote.saidAt),
          // Stagger createdAt so the feed order matches the array order.
          createdAt: new Date(now.getTime() + index * 1000),
          updatedAt: new Date(now.getTime() + index * 1000),
        })),
      );
      console.log(`Inserted ${DEMO.length} demo quotes.`);
    }
  }
} finally {
  await client.close();
}
