import { prisma } from "../../core/prisma";
import { badRequest } from "../../core/errors";

/**
 * Browsers report ICU's canonical names, which are often the *old* IANA spellings
 * (Chrome says "Asia/Calcutta" for India), while Postgres may only ship the current ones.
 * Map the legacy names people actually get, then confirm Postgres knows the result.
 */
const LEGACY: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Dacca": "Asia/Dhaka",
  "Asia/Thimbu": "Asia/Thimphu",
  "Asia/Ulan_Bator": "Asia/Ulaanbaatar",
  "Asia/Macao": "Asia/Macau",
  "Asia/Chongqing": "Asia/Shanghai",
  "Asia/Harbin": "Asia/Shanghai",
  "Asia/Tel_Aviv": "Asia/Jerusalem",
  "Europe/Kiev": "Europe/Kyiv",
  "Europe/Uzhgorod": "Europe/Kyiv",
  "Europe/Zaporozhye": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "America/Godthab": "America/Nuuk",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Louisville": "America/Kentucky/Louisville",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Africa/Asmera": "Africa/Asmara",
  "US/Eastern": "America/New_York",
  "US/Central": "America/Chicago",
  "US/Mountain": "America/Denver",
  "US/Pacific": "America/Los_Angeles",
  "Etc/UCT": "UTC",
  "Etc/UTC": "UTC",
  GMT: "UTC",
};

let known: Promise<Set<string>> | null = null;
const knownZones = () => {
  known ??= prisma.$queryRaw<{ name: string }[]>`SELECT name FROM pg_timezone_names`.then((rows) => new Set(rows.map((r) => r.name)));
  return known;
};

/** A zone name Postgres accepts, or a 400 the client can show. */
export const resolveTimeZone = async (tz: string): Promise<string> => {
  const zones = await knownZones();
  if (zones.has(tz)) return tz;
  const mapped = LEGACY[tz];
  if (mapped && zones.has(mapped)) return mapped;
  throw badRequest(`The time zone ${tz} isn't supported here`);
};
