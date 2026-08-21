/**
 * A stand-in for the organisation's directory, so the roster screen can be
 * played with before `ldap.ts` grows a name search of its own.
 *
 * What it holds is exactly what AD holds: an immutable objectGUID, a display
 * name, a title and a username. Note what it does *not* hold — turn order,
 * grammatical gender, or any notion of "the team". Those belong to the app,
 * which is the whole point of keeping the two apart.
 *
 * Client-safe, like `team.ts`: nothing here talks to a directory, it only
 * pretends to.
 */

export type DirectoryPerson = {
  /** objectGUID in canonical form — immutable, and survives a rename. */
  directoryId: string;
  displayName: string;
  title: string;
  /** sAMAccountName. Not unique over time: AD recycles these. */
  username: string;
};

export const DIRECTORY: DirectoryPerson[] = [
  { directoryId: "8a1f0c2e-4d3b-4a91-9f70-1c2d3e4f5a01", displayName: "נועה ברקת", title: "ראשת צוות", username: "noa.bareket" },
  { directoryId: "1c9d5b74-2e60-4f18-b3a2-7d51e0c48b12", displayName: "איתי שרון", title: "שרת", username: "itay.sharon" },
  { directoryId: "b6740f31-8c25-4d0a-9e63-5a29d7fb1c33", displayName: "שירה לוי", title: "לקוח", username: "shira.levi" },
  { directoryId: "3e82a5d0-77b9-4c46-8f11-6b0c94ae2d44", displayName: "דניאל עמר", title: "תשתיות", username: "daniel.amar" },
  { directoryId: "d05c3971-1a4e-4b82-97d5-2f6738ec9a55", displayName: "תמר רוזן", title: "בדיקות", username: "tamar.rozen" },
  { directoryId: "77b1e2c8-9f30-4a57-8d24-3c81b05fa766", displayName: "יונתן כץ", title: "שרת", username: "yonatan.katz" },
  { directoryId: "a4390d16-5b72-4e93-b108-9d47c2e6f877", displayName: "מאיה גלעד", title: "עיצוב מוצר", username: "maya.gilad" },
  { directoryId: "62fd8b40-3c19-4a75-9b86-0e5721da3c88", displayName: "אורי בן־חיים", title: "דאטה", username: "ori.benhaim" },

  // In the directory, off the rotation — which is the point of the two lists.
  { directoryId: "0f47a6e3-8d51-4062-a9c7-4b3e18df5099", displayName: "רועי אשכנזי", title: "שרת", username: "roi.ashkenazi" },
  { directoryId: "9b23c7f5-6e08-4d31-85a0-1f97e4b2c60a", displayName: "יעל מרקוביץ׳", title: "לקוח", username: "yael.markovich" },
  { directoryId: "45ea1d82-b904-4f67-93cb-8d02a57e1f1b", displayName: "שחר אדרי", title: "תשתיות", username: "shahar.edri" },

  // Everyone else in the building.
  { directoryId: "c81b04a7-2f56-4938-b7e1-6a34d90cf22c", displayName: "רון אלמוג", title: "שרת", username: "ron.almog" },
  { directoryId: "2d6f9e10-4a83-4c25-9f70-b51826ea7d3d", displayName: "ליאת שגב", title: "לקוח", username: "liat.segev" },
  { directoryId: "7a05b3c9-1d64-4e80-8b52-9c73f0ad684e", displayName: "אבישי דהן", title: "תשתיות", username: "avishai.dahan" },
  { directoryId: "e394720b-5c1f-4a68-93d4-7b0e2fc85a5f", displayName: "הילה נחמיאס", title: "בדיקות", username: "hila.nachmias" },
  { directoryId: "58c1f6d2-9b40-4738-a015-3e86b47dc960", displayName: "עומר פרץ", title: "דאטה", username: "omer.peretz" },
  // Deliberately close to "נועה ברקת" — a name search finds people, not accounts.
  { directoryId: "b7203e91-6a58-4c04-9d73-2f158be0a471", displayName: "נועה בר־און", title: "עיצוב מוצר", username: "noa.baron" },
  { directoryId: "34fa8c05-7e12-49b6-8a91-c0d637e5b482", displayName: "גלעד צור", title: "אבטחת מידע", username: "gilad.tsur" },
  { directoryId: "9e5d1a73-0c86-4b29-97f4-58ba31d0e693", displayName: "עדי שמש", title: "דאטה", username: "adi.shemesh" },
];

export function personByUsername(
  username: string,
): DirectoryPerson | undefined {
  return DIRECTORY.find((person) => person.username === username);
}

/** A real directory search is capped; this one matches. */
const MAX_RESULTS = 8;

/**
 * The real one is a substring filter on the service-account bind —
 * `(&(objectClass=user)(|(displayName=*x*)(sAMAccountName=*x*)))`, which is a
 * different query from `findUser`'s exact match on the login attributes. It
 * never binds as anyone, so it cannot touch a colleague's `badPwdCount`.
 */
export function searchDirectory(query: string): DirectoryPerson[] {
  const term = query.trim();

  // A one-character substring matches most of the company, and the real search
  // is capped server-side for the same reason.
  if (term.length < 2) return [];

  const lower = term.toLowerCase();

  return DIRECTORY.filter(
    (person) =>
      person.displayName.includes(term) || person.username.includes(lower),
  ).slice(0, MAX_RESULTS);
}
