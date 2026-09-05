const RESTAURANT_TIME_ZONE = "Asia/Ho_Chi_Minh";
const LUNCH_SLOTS = ["11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00"];
const DINNER_SLOTS = ["17:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00"];
const RESERVATION_SLOTS = [...LUNCH_SLOTS, ...DINNER_SLOTS];
const RESERVATION_DURATION_MINUTES = 120;
const NO_SHOW_GRACE_MINUTES = 15;

const isValidDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const parseReservationWallClock = (date, time) => {
  if (!isValidDate(date) || !RESERVATION_SLOTS.includes(time)) return null;
  return new Date(`${date}T${time}:00.000Z`);
};

const getRestaurantWallClockNow = (instant = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RESTAURANT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant).reduce((values, part) => {
    if (part.type !== "literal") values[part.type] = Number(part.value);
    return values;
  }, {});
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
};

const getWallClockDateString = (value = getRestaurantWallClockNow()) => value.toISOString().slice(0, 10);

const getWallClockDayBounds = (date) => {
  if (!isValidDate(date)) return null;
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

const addWallClockMinutes = (value, minutes) => new Date(new Date(value).getTime() + minutes * 60 * 1000);

export {
  DINNER_SLOTS,
  LUNCH_SLOTS,
  NO_SHOW_GRACE_MINUTES,
  RESERVATION_DURATION_MINUTES,
  RESERVATION_SLOTS,
  RESTAURANT_TIME_ZONE,
  addWallClockMinutes,
  getRestaurantWallClockNow,
  getWallClockDateString,
  getWallClockDayBounds,
  isValidDate,
  parseReservationWallClock,
};
