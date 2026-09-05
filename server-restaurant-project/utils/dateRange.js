const RESTAURANT_TIME_ZONE = "Asia/Ho_Chi_Minh";

const isValidDateInput = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const dateAtVietnamStart = (value) => new Date(`${value}T00:00:00+07:00`);

const parseVietnamDateRange = (dateFrom, dateTo) => {
  if ((dateFrom && !isValidDateInput(dateFrom)) || (dateTo && !isValidDateInput(dateTo))) return { error: "Date filters must use valid YYYY-MM-DD values." };
  const from = dateFrom ? dateAtVietnamStart(dateFrom) : null;
  const to = dateTo ? dateAtVietnamStart(dateTo) : null;
  if (to) to.setUTCDate(to.getUTCDate() + 1);
  if (from && to && from >= to) return { error: "The start date must not be after the end date." };
  return { from, to };
};

const getVietnamDateString = (instant = new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: RESTAURANT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(instant);

const addDateDays = (dateValue, days) => {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export { RESTAURANT_TIME_ZONE, addDateDays, getVietnamDateString, isValidDateInput, parseVietnamDateRange };
