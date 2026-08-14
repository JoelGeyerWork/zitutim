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
  const db = client.db(dbName);
  const quotes = db.collection("quotes");

  await quotes.createIndexes([
    { key: { createdAt: -1 } },
    { key: { saidAt: -1 } },
    { key: { author: 1 } },
    // "quotes I added", and the join comments and likes will want.
    { key: { addedById: 1 } },
  ]);

  await db.collection("users").createIndexes([
    { key: { directoryId: 1 }, unique: true },
    // Deliberately NOT unique: AD recycles sAMAccountNames, so the departed
    // colleague's document still holds the name. A unique index would reject
    // the new employee's very first login with a duplicate-key error and no
    // useful message.
    { key: { username: 1 } },
  ]);

  await db.collection("login_attempts").createIndexes([
    { key: { key: 1 }, unique: true },
    // Lets Mongo expire stale counters instead of the app sweeping them.
    { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  ]);

  console.log(`Indexes ready on ${dbName}: quotes, users, login_attempts`);

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
          // These predate authentication: the display name is all there is, so
          // there is nobody to attribute them to. Same shape as any quote added
          // before login existed.
          addedById: null,
          updatedBy: null,
          updatedById: null,
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
