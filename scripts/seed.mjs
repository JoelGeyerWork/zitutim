/**
 * Creates the indexes the app relies on and — with --demo — inserts a handful
 * of sample quotes, the roster, the sample themes and both rotations, so no
 * screen is empty on a fresh database.
 *
 *   node --env-file=.env.local scripts/seed.mjs
 *   node --env-file=.env.local scripts/seed.mjs --demo
 */
import { MongoClient, ObjectId } from "mongodb";

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
 * The roster members a theme, a shift, a review or a certificate can name.
 * Duplicated here rather than imported — this is a plain `.mjs` script with no
 * `@/lib` path alias, the same reason `DEMO` above is not read from `quotes.ts`.
 *
 * Keyed on an objectGUID, so a seeded row and the same person signing in
 * through LDAP land on one `users` row, not two. `key` is the slug the sample
 * content below references.
 *
 * `_id` is fixed rather than minted, so a fresh database always gives the same
 * person the same `users._id`. That is what lets later demo content — the
 * שוטף reviews and the hall of fame, whose fixtures still FK against these
 * slugs — be written against a known id instead of one this run invented. It
 * is applied through `$setOnInsert`, so a database that already holds these
 * people keeps whatever ids it minted the first time; everything below reads
 * `idByKey` rather than the constant for exactly that reason.
 */
const ROSTER_SEED = [
  { key: "noa", _id: "5eed00000000000000000001", directoryId: "8a1f0c2e-4d3b-4a91-9f70-1c2d3e4f5a01", displayName: "נועה ברקת", title: "ראשת צוות", username: "noa.bareket", gender: "f" },
  { key: "itay", _id: "5eed00000000000000000002", directoryId: "1c9d5b74-2e60-4f18-b3a2-7d51e0c48b12", displayName: "איתי שרון", title: "שרת", username: "itay.sharon", gender: "m" },
  { key: "shira", _id: "5eed00000000000000000003", directoryId: "b6740f31-8c25-4d0a-9e63-5a29d7fb1c33", displayName: "שירה לוי", title: "לקוח", username: "shira.levi", gender: "f" },
  { key: "daniel", _id: "5eed00000000000000000004", directoryId: "3e82a5d0-77b9-4c46-8f11-6b0c94ae2d44", displayName: "דניאל עמר", title: "תשתיות", username: "daniel.amar", gender: "m" },
  { key: "tamar", _id: "5eed00000000000000000005", directoryId: "d05c3971-1a4e-4b82-97d5-2f6738ec9a55", displayName: "תמר רוזן", title: "בדיקות", username: "tamar.rozen", gender: "f" },
  { key: "yonatan", _id: "5eed00000000000000000006", directoryId: "77b1e2c8-9f30-4a57-8d24-3c81b05fa766", displayName: "יונתן כץ", title: "שרת", username: "yonatan.katz", gender: "m" },
  { key: "maya", _id: "5eed00000000000000000007", directoryId: "a4390d16-5b72-4e93-b108-9d47c2e6f877", displayName: "מאיה גלעד", title: "עיצוב מוצר", username: "maya.gilad", gender: "f" },
  { key: "ori", _id: "5eed00000000000000000008", directoryId: "62fd8b40-3c19-4a75-9b86-0e5721da3c88", displayName: "אורי בן־חיים", title: "דאטה", username: "ori.benhaim", gender: "m" },
];

/**
 * The שוטף rotation, in turn order — the same eight, since it is the same team
 * taking a different week. It is a *second row* in the `rotation` collection
 * (`_id: "shotef"`), not a second collection: the shape is identical and the
 * singleton reasoning in `src/lib/rotation.ts` is worth having exactly once.
 */
const SHOTEF_ORDER = ["noa", "itay", "shira", "daniel", "tamar", "yonatan", "maya", "ori"];

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

/**
 * The weekly summaries, mirroring `shotef-schema.ts`. `member` is a ROSTER_SEED
 * key, resolved through `idByKey` — never a hardcoded id, since the seeded `_id`
 * is `$setOnInsert` and an existing database keeps the one it minted. Every
 * `weekStart` is a Sunday: a shift is a whole Sunday-to-Saturday week.
 */
const SHOTEF_REVIEWS_SEED = [
  { weekStart: "2026-08-16", member: "daniel", rating: 5, headline: "שבוע שקט שנגמר בשדרוג", body: "שתי תקלות קטנות, שתיהן נסגרו באותו יום. בין לבין דניאל ניקה את התראות הרעש שהצטברו בחודשים האחרונים — מאז יש חצי מהפינגים ואף אחד לא מתגעגע." },
  { weekStart: "2026-08-09", member: "tamar", rating: 4, headline: "גל תקלות מהשחרור של יום שני", body: "השחרור הביא איתו גל פניות ביומיים. תמר תיעדה כל אחת, זיהתה שכולן אותו באג ופתחה תיקון אחד במקום להתמודד עם כל אחת לחוד. ירד כוכב רק כי ההודעה לצוות יצאה באיחור." },
  { weekStart: "2026-08-02", member: "yonatan", rating: 3, headline: "שבוע בינוני, בעיקר בגלל התור", body: "הכול טופל בסוף — אבל חלק מהפניות חיכו יומיים כי לא היה ברור למי הן שייכות. הפתק שנשאר אחריו: להגדיר בעלות לפני שהתור מתמלא, לא אחרי." },
  { weekStart: "2026-07-26", member: "shira", rating: 5, headline: "התקלה של הלקוח הגדול נסגרה תוך שעתיים", body: "פנייה דחופה נכנסה ברבע לחמש ביום רביעי. שירה שחזרה, מצאה, תיקנה ועדכנה את הלקוח לפני שהוא הספיק לשאול שוב. שאר השבוע היה שקט." },
  { weekStart: "2026-07-19", member: "ori", rating: 2, headline: "שבוע קשה, ולא באשמת אף אחד", body: "שבוע עמוס, שתי התראות לילה ותקלת רשת שלא הייתה שלנו בכלל. אורי החזיק את הראש מעל המים, אבל מהשבוע הזה יצאנו עם מסקנה אחת: שוטף אחד לא מספיק בשבוע שחרור גדול." },
  { weekStart: "2026-07-12", member: "maya", rating: 4, headline: "רוב הפניות בכלל לא היו באגים", body: "כמעט כל מה שנכנס היה שאלות שימוש. מאיה ענתה, ואז כתבה מהן דף עזרה קצר שמאז חוסך לנו את אותן שאלות בדיוק." },
];

/**
 * The hall of fame, mirroring `shotef-schema.ts`. `solvedBy` holds ROSTER_SEED
 * keys — a certificate names everyone who was on the call, which is why this is
 * an array and not a single name.
 */
const MONITORS_SEED = [
  { icon: "memory", monitor: "db-prod-01: RAM above 95%", solvedBy: ["ori", "daniel"], firstFiredAt: "2026-06-09", solvedAt: "2026-08-18", minutesToFix: 180, solution: "לא דליפה — שאילתת דוח חודשית רצה בלי אינדקס ומשכה את כל הטבלה לזיכרון. הוספנו אינדקס מורכב על tenant ועל created_at, וזמן הריצה ירד מארבע דקות לשתי שניות. הזיכרון חזר ל-40% ולא עלה מאז." },
  { icon: "backup", monitor: "backup: last successful backup older than 48h", solvedBy: ["daniel"], firstFiredAt: "2026-08-08", solvedAt: "2026-08-11", minutesToFix: 300, solution: "הגיבוי נכשל בשקט שלושה לילות אחרי ששינינו שם של דיסק — הסקריפט המשיך לדווח הצלחה כי בדק רק שהוא רץ, לא שהוא כתב. תיקנו את הנתיב, החלפנו את הבדיקה בקוד היציאה של המשימה, וגם שחזרנו גיבוי אחד כדי לוודא שיש מה לשחזר." },
  { icon: "loop", monitor: "ingest-queue: consumer lag > 10k", solvedBy: ["yonatan", "itay"], firstFiredAt: "2026-08-05", solvedAt: "2026-08-06", minutesToFix: 2160, solution: "צרכן אחד נתקע על הודעה פגומה וניסה אותה שוב ושוב בלולאה אינסופית. הוספנו תור מכתבים־מתים אחרי שלושה ניסיונות, והפעם גם התראה על התור הזה — כדי שהודעה פגומה תהיה שקופה במקום להיות שקטה." },
  { icon: "certificate", monitor: "gateway: TLS certificate expires in 3 days", solvedBy: ["daniel"], firstFiredAt: "2026-07-26", solvedAt: "2026-07-29", minutesToFix: 60, solution: "חידוש ידני שאף אחד לא נזכר בו. חידשנו, ואז החלפנו את הזיכרון האנושי בקרון שמחדש 30 יום מראש ומדווח לערוץ. ההתראה נשארה — היא עכשיו רשת ביטחון ולא לוח שנה." },
  { icon: "fire", monitor: "api: 5xx rate above 2% for 5m", solvedBy: ["itay", "yonatan"], firstFiredAt: "2026-07-21", solvedAt: "2026-07-21", minutesToFix: 11, solution: "שחרור שהוסיף שדה חובה לבקשה בלי לעדכן את האפליקציה בנייד. החזרנו לאחור תוך אחת־עשרה דקות, ואז שחררנו מחדש כששני הצדדים מסונכרנים. מאז שדה חובה חדש עובר קודם דרך שלב שבו הוא עדיין אופציונלי." },
  { icon: "latency", monitor: "web: p95 latency above 2s", solvedBy: ["itay", "maya"], firstFiredAt: "2026-05-20", solvedAt: "2026-07-06", minutesToFix: 240, solution: "וידג׳ט חדש בדף הבית שאל את מסד הנתונים פעם אחת לכל שורה שהוא הציג — שמונים שאילתות בטעינה אחת. איחדנו אותן לשאילתה אחת, וה-p95 חזר מ-2.4 שניות ל-400 מילישניות." },
  { icon: "disk", monitor: "app-03: disk usage above 90%", solvedBy: ["tamar"], firstFiredAt: "2026-06-16", solvedAt: "2026-06-30", minutesToFix: 120, solution: "לוגים בלי סבב. פינינו, הגדרנו logrotate יומי עם שמירה לשבועיים, והורדנו את רמת הלוג של הבריאות מ-debug ל-info. תפוסת הדיסק יציבה על 55%." },
  { icon: "pipeline", monitor: "etl: nightly export failed", solvedBy: ["ori"], firstFiredAt: "2026-06-13", solvedAt: "2026-06-22", minutesToFix: 90, solution: "המקור הוסיף עמודה, והטוען שלנו נפל על סכימה שלא הכיר. עכשיו הוא סופג עמודות שאינן מוכרות לו במקום ליפול, ומדווח עליהן בבוקר — טעינה שנכשלת היא בעיה, טעינה שמפתיעה היא רק ידיעה." },
  { icon: "network", monitor: "auth: LDAP bind timeouts", solvedBy: ["noa", "daniel"], firstFiredAt: "2026-06-10", solvedAt: "2026-06-11", minutesToFix: 240, solution: "לא אנחנו — בקר תחום אחד מתוך שלושה יצא מהאוויר, והקליינט המשיך לנסות דווקא אותו. פנינו לתשתיות, ובינתיים קיצרנו את הטיים־אאוט וסידרנו מעבר לבקר הבא ברשימה. הכניסה נשארה עובדת גם כשבקר נופל." },
  { icon: "cache", monitor: "cache: hit rate below 60%", solvedBy: ["maya"], firstFiredAt: "2026-01-12", solvedAt: "2026-05-24", minutesToFix: 1440, solution: "כל המפתחות פגו באותה שנייה בדיוק, ואז כולם רצו יחד למסד הנתונים. פיזרנו את תוקף המפתחות באקראי בעד עשר אחוז, וההצלחה חזרה ל-94%." },
  { icon: "index", monitor: "search: index rebuild stuck for 6h", solvedBy: ["ori", "tamar"], firstFiredAt: "2025-03-02", solvedAt: "2026-05-10", minutesToFix: 150, solution: "בנייה מחדש שרצה על אותו מסמך פגום עד אינסוף. דילגנו עליו, המשכנו את הבנייה, ואז הוספנו לה יומן התקדמות — מאז בנייה תקועה נראית תקועה תוך דקות במקום תוך חצי יום." },
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

  await db.collection("shotef_reviews").createIndexes([
    // One week, one summary. The 409 is caught off this index rather than off a
    // findOne first: a pre-check races two people writing up the same week.
    { key: { weekStart: -1 }, unique: true },
  ]);

  await db.collection("shotef_monitors").createIndexes([
    // The wall reads newest-save-first, and ends in _id for a total order.
    { key: { solvedAt: -1, _id: -1 } },
    // Whole-key, in the exact order `getFastestFix` sorts by. A bare
    // `{ minutesToFix: 1 }` is only a *prefix* of that sort, so Mongo cannot
    // use it to satisfy the order and falls back to a blocking sort over a
    // collection scan — an index that looks like it is working and is not.
    { key: { minutesToFix: 1, solvedAt: -1, _id: -1 } },
    // `countSolvers` distincts on this. The podium's aggregation opens with
    // $project/$unwind and reaches no index at all — deliberately unindexed
    // rather than carrying one that cannot be used.
    { key: { solvedByIds: 1 } },
  ]);

  console.log(
    `Indexes ready on ${dbName}: quotes, users, login_attempts, themes, quote_likes, quote_comments, shotef_reviews, shotef_monitors`,
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
          // before login existed — including the speaker, who is a name and not
          // a `users` row, exactly like a quote whose author was typed.
          authorId: null,
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
          $setOnInsert: {
            _id: new ObjectId(member._id),
            directoryId: member.directoryId,
            createdAt: now,
          },
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

    // The two rotation singletons: the ישב״צ refreshment rotation and the שוטף
    // on-call rotation, each the same eight in seeded order and each carrying
    // the grammatical gender the directory has no field for. Both are addressed
    // only through their fixed `_id`, and each is a no-op once it already holds
    // members — so re-running the seed never clobbers an edited rotation, and
    // seeding one is independent of the other.
    const rotation = db.collection("rotation");
    const genderByKey = Object.fromEntries(
      ROSTER_SEED.map((member) => [member.key, member.gender]),
    );

    for (const [id, label, order] of [
      ["current", "the meetup rotation", ROSTER_SEED.map((member) => member.key)],
      ["shotef", "the שוטף rotation", SHOTEF_ORDER],
    ]) {
      const existing = await rotation.findOne({ _id: id });
      if (existing?.members?.length > 0) {
        console.log(
          `Skipping ${label} — already ${existing.members.length} members.`,
        );
        continue;
      }

      await rotation.findOneAndUpdate(
        { _id: id },
        {
          $set: {
            members: order.map((key) => ({
              userId: idByKey[key],
              gender: genderByKey[key],
            })),
            updatedAt: now,
          },
        },
        { upsert: true },
      );
      console.log(`Seeded ${label} with ${order.length} members.`);
    }

    // The שוטף section's own two collections. Both read `idByKey` rather than
    // the fixed `_id`s in ROSTER_SEED: those are `$setOnInsert`, so a database
    // that already held these people kept the ids it minted.
    const existingReviews = await db.collection("shotef_reviews").countDocuments();
    if (existingReviews > 0) {
      console.log(
        `Skipping demo shotef reviews — ${existingReviews} already present.`,
      );
    } else {
      await db.collection("shotef_reviews").insertMany(
        SHOTEF_REVIEWS_SEED.map((review) => ({
          // Parsed as UTC midnight, which is how the app stores and renders it.
          weekStart: new Date(review.weekStart),
          memberId: idByKey[review.member],
          rating: review.rating,
          headline: review.headline,
          body: review.body,
          // Seeded, so nobody typed them in — same shape as a pre-auth quote.
          addedBy: null,
          addedById: null,
          createdAt: now,
        })),
      );
      console.log(`Seeded ${SHOTEF_REVIEWS_SEED.length} demo shotef reviews.`);
    }

    const existingMonitors = await db.collection("shotef_monitors").countDocuments();
    if (existingMonitors > 0) {
      console.log(
        `Skipping the hall of fame — ${existingMonitors} certificates already present.`,
      );
    } else {
      await db.collection("shotef_monitors").insertMany(
        MONITORS_SEED.map((monitor, index) => ({
          icon: monitor.icon,
          monitor: monitor.monitor,
          solution: monitor.solution,
          solvedByIds: monitor.solvedBy.map((key) => idByKey[key]),
          firstFiredAt: new Date(monitor.firstFiredAt),
          solvedAt: new Date(monitor.solvedAt),
          minutesToFix: monitor.minutesToFix,
          addedBy: null,
          addedById: null,
          createdAt: new Date(now.getTime() + index * 1000),
        })),
      );
      console.log(`Seeded ${MONITORS_SEED.length} hall-of-fame certificates.`);
    }
  }
} finally {
  await client.close();
}
