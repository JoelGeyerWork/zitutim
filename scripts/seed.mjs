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

/**
 * The roster members a theme can name. Duplicated here rather than imported —
 * this is a plain `.mjs` script with no `@/lib` path alias, the same reason
 * `DEMO` above is not read from `quotes.ts`.
 *
 * Keyed on the objectGUID from `directory.ts`, so a themes-seeded row and the
 * same person signing in through LDAP land on one `users` row, not two. `key`
 * is the `team.ts` id the sample themes below reference.
 */
const ROSTER_SEED = [
  { key: "noa", directoryId: "8a1f0c2e-4d3b-4a91-9f70-1c2d3e4f5a01", displayName: "נועה ברקת", title: "ראשת צוות", username: "noa.bareket", gender: "f" },
  { key: "itay", directoryId: "1c9d5b74-2e60-4f18-b3a2-7d51e0c48b12", displayName: "איתי שרון", title: "שרת", username: "itay.sharon", gender: "m" },
  { key: "shira", directoryId: "b6740f31-8c25-4d0a-9e63-5a29d7fb1c33", displayName: "שירה לוי", title: "לקוח", username: "shira.levi", gender: "f" },
  { key: "daniel", directoryId: "3e82a5d0-77b9-4c46-8f11-6b0c94ae2d44", displayName: "דניאל עמר", title: "תשתיות", username: "daniel.amar", gender: "m" },
  { key: "tamar", directoryId: "d05c3971-1a4e-4b82-97d5-2f6738ec9a55", displayName: "תמר רוזן", title: "בדיקות", username: "tamar.rozen", gender: "f" },
  { key: "yonatan", directoryId: "77b1e2c8-9f30-4a57-8d24-3c81b05fa766", displayName: "יונתן כץ", title: "שרת", username: "yonatan.katz", gender: "m" },
  { key: "maya", directoryId: "a4390d16-5b72-4e93-b108-9d47c2e6f877", displayName: "מאיה גלעד", title: "עיצוב מוצר", username: "maya.gilad", gender: "f" },
  { key: "ori", directoryId: "62fd8b40-3c19-4a75-9b86-0e5721da3c88", displayName: "אורי בן־חיים", title: "דאטה", username: "ori.benhaim", gender: "m" },
];

/** The sample themes, mirroring `themes.ts`. `key` fields map to ROSTER_SEED. */
const THEMES_SEED = [
  { date: "2026-08-11", broughtBy: "ori", theme: "הכול עגול", snacks: ["בייגלה", "דונאטס", "אוראו", "ענבים"], guessedBy: "tamar" },
  { date: "2026-08-04", broughtBy: "maya", theme: "ראשי התיבות מרכיבות את המילה צוות", snacks: ["צ׳יפס", "ופלים", "ופל בלגי", "תמרים"], guessedBy: "daniel" },
  { date: "2026-07-28", broughtBy: "yonatan", theme: "מקסיקו", snacks: ["נאצ׳וס", "גוואקמולה", "סלסה", "צ׳ורוס"], guessedBy: "shira" },
  { date: "2026-07-21", broughtBy: "tamar", theme: "אוכל של ילדות", snacks: ["במבה", "קרמבו", "שוקו בשקית", "ביסלי גריל"], guessedBy: "noa" },
  { date: "2026-07-14", broughtBy: "daniel", theme: "הכול מתחיל באות ב׳", snacks: ["בורקס", "בננות", "בייגל", "בקלאווה"], guessedBy: null },
  { date: "2026-07-07", broughtBy: "shira", theme: "אסיה", snacks: ["סושי", "אדממה", "מוצ׳י", "תה ירוק"], guessedBy: "tamar" },
  { date: "2026-06-30", broughtBy: "itay", theme: "בלי גרם סוכר", snacks: ["אגוזים", "גבינה בולגרית", "מלפפונים", "טחינה"], guessedBy: "yonatan" },
  { date: "2026-06-23", broughtBy: "noa", theme: "כל מה שאפשר לאכול ביד אחת", snacks: ["פיצה בפרוסות", "לאפה", "תפוח", "חטיף אנרגיה"], guessedBy: "tamar" },
  { date: "2026-06-16", broughtBy: "ori", theme: "אדום בלבד", snacks: ["עגבניות שרי", "פלפל אדום", "תותים", "מיץ רימונים"], guessedBy: "maya" },
  { date: "2026-06-09", broughtBy: "maya", theme: "הכול מהמכולת שלמטה", snacks: ["קרקרים", "גבינה צהובה", "זיתים", "לימונדה"], guessedBy: null },
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

  await db.collection("themes").createIndexes([
    // One meetup, one theme: a duplicate date is a 409, caught off this index.
    { key: { date: -1 }, unique: true },
    // The leaderboard groups guesses by this.
    { key: { guessedById: 1 } },
  ]);

  await db.collection("quote_likes").createIndexes([
    // PUT retries are idempotent, but this remains the final one-like boundary.
    { key: { quoteId: 1, userId: 1 }, unique: true },
  ]);

  await db.collection("quote_comments").createIndexes([
    // Covers both the oldest-first conversation and latest-two preview scans.
    { key: { quoteId: 1, createdAt: 1, _id: 1 } },
    { key: { authorId: 1 } },
  ]);

  console.log(
    `Indexes ready on ${dbName}: quotes, users, login_attempts, themes, quote_likes, quote_comments`,
  );

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

    const now = new Date();
    const users = db.collection("users");

    // A `users` row per roster member, so both the themes and the rotation below
    // reference a real document. Keyed on directoryId and idempotent, exactly
    // like a real login — so this runs unconditionally in --demo mode and the
    // same person signing in through LDAP lands on the very same row.
    const idByKey = {};
    const nameByKey = {};
    for (const member of ROSTER_SEED) {
      const result = await users.findOneAndUpdate(
        { directoryId: member.directoryId },
        {
          $set: {
            username: member.username,
            upn: null,
            displayName: member.displayName,
            title: member.title,
            mail: null,
            dn: `CN=${member.username}`,
            updatedAt: now,
            lastLoginAt: now,
          },
          $setOnInsert: { directoryId: member.directoryId, createdAt: now },
        },
        { upsert: true, returnDocument: "after" },
      );
      idByKey[member.key] = result._id;
      nameByKey[member.key] = member.displayName;
    }

    const existingThemes = await db.collection("themes").countDocuments();
    if (existingThemes > 0) {
      console.log(
        `Skipping demo themes — ${existingThemes} themes already present.`,
      );
    } else {
      await db.collection("themes").insertMany(
        THEMES_SEED.map((theme, index) => ({
          date: new Date(theme.date),
          broughtById: idByKey[theme.broughtBy],
          broughtBy: nameByKey[theme.broughtBy],
          theme: theme.theme,
          snacks: theme.snacks,
          guessedById: theme.guessedBy ? idByKey[theme.guessedBy] : null,
          guessedBy: theme.guessedBy ? nameByKey[theme.guessedBy] : null,
          // Seeded, so nobody typed them in — same shape as a pre-auth quote.
          addedBy: null,
          addedById: null,
          updatedBy: null,
          updatedById: null,
          createdAt: new Date(now.getTime() + index * 1000),
          updatedAt: new Date(now.getTime() + index * 1000),
        })),
      );
      console.log(
        `Seeded ${ROSTER_SEED.length} roster users and ${THEMES_SEED.length} demo themes.`,
      );
    }

    // The rotation singleton: the same eight, in seeded order, each with the
    // grammatical gender the directory has no field for. Addressed only through
    // the fixed `_id`, and a no-op once it already holds members — so re-running
    // the seed never clobbers an edited rotation.
    const rotation = db.collection("rotation");
    const existingRotation = await rotation.findOne({ _id: "current" });
    if (existingRotation?.members?.length > 0) {
      console.log(
        `Skipping rotation — already ${existingRotation.members.length} in the rotation.`,
      );
    } else {
      await rotation.findOneAndUpdate(
        { _id: "current" },
        {
          $set: {
            members: ROSTER_SEED.map((member) => ({
              userId: idByKey[member.key],
              gender: member.gender,
            })),
            updatedAt: now,
          },
        },
        { upsert: true },
      );
      console.log(`Seeded the rotation with ${ROSTER_SEED.length} members.`);
    }
  }
} finally {
  await client.close();
}
