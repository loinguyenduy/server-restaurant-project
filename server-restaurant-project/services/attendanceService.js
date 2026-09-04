import { Op, QueryTypes } from "sequelize";
import { Attendance, User, sequelize } from "../models/index.js";
import { getVietnamDateString, parseVietnamDateRange } from "../utils/dateRange.js";

const makeResult = (EC, EM, DT = "") => ({ EC, EM, DT });

const parsePage = (value, fallback, maximum) => {
  if (value === undefined || value === "") return fallback;
  return /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= maximum ? Number(value) : null;
};

const serializeAttendance = (record) => {
  const value = record?.get ? record.get({ plain: true }) : record;
  if (!value) return value;
  const start = new Date(value.check_in_time).getTime();
  const end = value.check_out_time ? new Date(value.check_out_time).getTime() : null;
  const invalid = end !== null && (!Number.isFinite(start) || !Number.isFinite(end) || end < start);
  return {
    ...value,
    is_open: end === null,
    worked_minutes: end !== null && !invalid ? Math.floor((end - start) / 60000) : null,
    has_invalid_duration: invalid,
  };
};

const buildCheckInRange = (dateFrom, dateTo) => {
  const parsed = parseVietnamDateRange(dateFrom, dateTo);
  if (parsed.error) return parsed;
  const range = {};
  if (parsed.from) range[Op.gte] = parsed.from;
  if (parsed.to) range[Op.lt] = parsed.to;
  return {
    from: parsed.from,
    to: parsed.to,
    range: Object.getOwnPropertySymbols(range).length ? range : null,
  };
};

const getTodayAttendanceSummary = async (userId) => {
  const today = getVietnamDateString();
  const parsed = parseVietnamDateRange(today, today);
  const [summary = {}] = await Attendance.findAll({
    where: { user_id: userId, check_in_time: { [Op.gte]: parsed.from, [Op.lt]: parsed.to } },
    attributes: [
      [sequelize.fn("COUNT", sequelize.col("id")), "session_count"],
      [sequelize.literal("SUM(CASE WHEN check_out_time IS NULL THEN 1 ELSE 0 END)"), "open_session_count"],
      [sequelize.literal("SUM(CASE WHEN check_out_time IS NOT NULL AND check_out_time >= check_in_time THEN 1 ELSE 0 END)"), "completed_session_count"],
      [sequelize.literal("COALESCE(SUM(CASE WHEN check_out_time IS NOT NULL AND check_out_time >= check_in_time THEN TIMESTAMPDIFF(MINUTE, check_in_time, check_out_time) ELSE 0 END), 0)"), "total_worked_minutes"],
    ],
    raw: true,
  });
  return {
    date: today,
    session_count: Number(summary.session_count || 0),
    open_session_count: Number(summary.open_session_count || 0),
    completed_session_count: Number(summary.completed_session_count || 0),
    total_worked_minutes: Number(summary.total_worked_minutes || 0),
    semantics: "Today's completed time includes valid completed sessions whose check-in date is today in Asia/Ho_Chi_Minh. Open sessions are shown separately and are not included.",
  };
};

const checkCurrentStatusService = async (userId) => {
  try {
    const [openRecords, today] = await Promise.all([
      Attendance.findAll({ where: { user_id: userId, check_out_time: null }, order: [["check_in_time", "DESC"]], limit: 2 }),
      getTodayAttendanceSummary(userId),
    ]);
    if (openRecords.length > 1) return makeResult(409, "Multiple open shifts were found. Contact an administrator before continuing.");
    const latestRecord = openRecords[0] || await Attendance.findOne({ where: { user_id: userId }, order: [["check_in_time", "DESC"]] });
    return makeResult(0, openRecords.length ? "User is clocked in." : "User is clocked out.", {
      isClockedIn: openRecords.length === 1,
      latestRecord: serializeAttendance(latestRecord),
      server_timestamp: new Date().toISOString(),
      today,
    });
  } catch (error) {
    console.error("Error checking attendance status:", error);
    return makeResult(500, "Unable to check attendance status.");
  }
};

const checkInService = async (userId) => {
  const transaction = await sequelize.transaction();
  try {
    const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!user || user.role !== "staff") { await transaction.rollback(); return makeResult(403, "Only active Staff accounts can check in."); }
    const open = await Attendance.findAll({ where: { user_id: userId, check_out_time: null }, transaction, lock: transaction.LOCK.UPDATE });
    if (open.length > 1) { await transaction.rollback(); return makeResult(409, "Multiple open shifts were found. Contact an administrator."); }
    if (open.length === 1) { await transaction.rollback(); return makeResult(409, "You are already clocked in."); }
    const record = await Attendance.create({ user_id: userId, check_in_time: new Date() }, { transaction });
    await transaction.commit();
    return makeResult(0, "Check-in successful.", serializeAttendance(record));
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    console.error("Error checking in:", error);
    return makeResult(500, "Unable to check in.");
  }
};

const checkOutService = async (userId) => {
  const transaction = await sequelize.transaction();
  try {
    const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!user || user.role !== "staff") { await transaction.rollback(); return makeResult(403, "Only active Staff accounts can check out."); }
    const open = await Attendance.findAll({ where: { user_id: userId, check_out_time: null }, order: [["check_in_time", "DESC"]], transaction, lock: transaction.LOCK.UPDATE });
    if (open.length > 1) { await transaction.rollback(); return makeResult(409, "Multiple open shifts were found. Contact an administrator."); }
    if (open.length === 0) { await transaction.rollback(); return makeResult(409, "No active shift found. Check in first."); }
    const checkoutTime = new Date();
    if (checkoutTime < new Date(open[0].check_in_time)) { await transaction.rollback(); return makeResult(409, "The server clock would create an invalid shift duration."); }
    await open[0].update({ check_out_time: checkoutTime }, { transaction });
    await transaction.commit();
    return makeResult(0, "Check-out successful.", serializeAttendance(open[0]));
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    console.error("Error checking out:", error);
    return makeResult(500, "Unable to check out.");
  }
};

const getOwnAttendanceHistoryService = async (userId, options = {}) => {
  try {
    const page = parsePage(options.page, 1, 100000);
    const limit = parsePage(options.limit, 20, 100);
    if (!page || !limit) return makeResult(400, "Invalid attendance pagination.");
    const checkInRange = buildCheckInRange(options.dateFrom, options.dateTo);
    if (checkInRange.error) return makeResult(400, checkInRange.error);
    const where = { user_id: userId };
    if (checkInRange.range) where.check_in_time = checkInRange.range;
    const result = await Attendance.findAndCountAll({ where, order: [["check_in_time", "DESC"]], limit, offset: (page - 1) * limit });
    return makeResult(0, "Attendance history retrieved successfully.", {
      logs: result.rows.map(serializeAttendance),
      page,
      limit,
      totalRows: result.count,
      totalPages: Math.ceil(result.count / limit),
      semantics: "A shift belongs to the selected date range by check-in time. Its full completed duration is counted there; overnight shifts are not split.",
    });
  } catch (error) {
    console.error("Error retrieving own attendance history:", error);
    return makeResult(500, "Unable to retrieve attendance history.");
  }
};

const getAttendanceLogService = async (options = {}) => {
  try {
    const page = parsePage(options.page, 1, 100000);
    const limit = parsePage(options.limit, 20, 100);
    if (!page || !limit) return makeResult(400, "Invalid attendance pagination.");
    const checkInRange = buildCheckInRange(options.dateFrom, options.dateTo);
    if (checkInRange.error) return makeResult(400, checkInRange.error);
    const status = String(options.status || "all").toLowerCase();
    if (!["all", "open", "completed"].includes(status)) return makeResult(400, "Invalid attendance status filter.");
    const search = String(options.search || "").trim();
    if (search.length > 100) return makeResult(400, "Search must be 100 characters or fewer.");
    const where = {};
    if (options.userId) where.user_id = options.userId;
    if (checkInRange.range) where.check_in_time = checkInRange.range;
    if (status === "open") where.check_out_time = null;
    if (status === "completed") where.check_out_time = { [Op.ne]: null };
    const userWhere = { role: "staff" };
    if (search) userWhere[Op.or] = [{ full_name: { [Op.like]: `%${search}%` } }, { email: { [Op.like]: `%${search}%` } }];
    const result = await Attendance.findAndCountAll({
      where,
      include: [{ model: User, attributes: ["id", "full_name", "email"], where: userWhere }],
      order: [["check_in_time", "DESC"]],
      limit,
      offset: (page - 1) * limit,
      distinct: true,
    });
    return makeResult(0, "Attendance logs retrieved successfully.", {
      logs: result.rows.map(serializeAttendance),
      page,
      limit,
      totalRows: result.count,
      totalPages: Math.ceil(result.count / limit),
      semantics: "A shift belongs to the selected date range by check-in time. Its full completed duration is counted there; overnight shifts are not split.",
    });
  } catch (error) {
    console.error("Error retrieving attendance logs:", error);
    return makeResult(500, "Unable to retrieve attendance logs.");
  }
};

const getAttendanceSummaryService = async (options = {}) => {
  try {
    const page = parsePage(options.page, 1, 100000);
    const limit = parsePage(options.limit, 20, 100);
    if (!page || !limit) return makeResult(400, "Invalid attendance summary pagination.");
    const checkInRange = buildCheckInRange(options.dateFrom, options.dateTo);
    if (checkInRange.error) return makeResult(400, checkInRange.error);
    const search = String(options.search || "").trim();
    if (search.length > 100) return makeResult(400, "Search must be 100 characters or fewer.");
    const userWhere = { role: "staff" };
    if (search) userWhere[Op.or] = [{ full_name: { [Op.like]: `%${search}%` } }, { email: { [Op.like]: `%${search}%` } }];
    const users = await User.findAndCountAll({ where: userWhere, attributes: ["id", "full_name", "email", "is_active"], order: [["full_name", "ASC"]], limit, offset: (page - 1) * limit });
    const ids = users.rows.map((user) => user.id);
    const attendanceWhere = { user_id: { [Op.in]: ids } };
    if (checkInRange.range) attendanceWhere.check_in_time = checkInRange.range;
    const [aggregates, currentOpenRows] = ids.length ? await Promise.all([
      Attendance.findAll({
        where: attendanceWhere,
        attributes: [
          "user_id",
          [sequelize.fn("COUNT", sequelize.col("id")), "shift_count"],
          [sequelize.literal("SUM(CASE WHEN check_out_time IS NULL THEN 1 ELSE 0 END)"), "open_shift_count"],
          [sequelize.literal("SUM(CASE WHEN check_out_time IS NOT NULL AND check_out_time >= check_in_time THEN 1 ELSE 0 END)"), "completed_shift_count"],
          [sequelize.literal("COALESCE(SUM(CASE WHEN check_out_time IS NOT NULL AND check_out_time >= check_in_time THEN TIMESTAMPDIFF(MINUTE, check_in_time, check_out_time) ELSE 0 END), 0)"), "total_worked_minutes"],
        ],
        group: ["user_id"],
        raw: true,
      }),
      Attendance.findAll({ where: { user_id: { [Op.in]: ids }, check_out_time: null }, attributes: ["user_id"], group: ["user_id"], raw: true }),
    ]) : [[], []];
    const byUser = new Map(aggregates.map((row) => [row.user_id, row]));
    const currentOpenIds = new Set(currentOpenRows.map((row) => row.user_id));
    const summaries = users.rows.map((user) => {
      const row = byUser.get(user.id) || {};
      const completed = Number(row.completed_shift_count || 0);
      const total = Number(row.total_worked_minutes || 0);
      return {
        ...user.get({ plain: true }),
        shift_count: Number(row.shift_count || 0),
        open_shift_count: Number(row.open_shift_count || 0),
        completed_shift_count: completed,
        total_worked_minutes: total,
        average_completed_shift_minutes: completed ? Math.round(total / completed) : 0,
        is_currently_checked_in: currentOpenIds.has(user.id),
      };
    });
    return makeResult(0, "Attendance summary retrieved successfully.", {
      summaries,
      page,
      limit,
      totalRows: users.count,
      totalPages: Math.ceil(users.count / limit),
      semantics: "Shifts are attributed by check-in time. Full completed duration is counted without splitting overnight shifts. Current check-in state is a live snapshot independent of the selected period.",
    });
  } catch (error) {
    console.error("Error retrieving attendance summary:", error);
    return makeResult(500, "Unable to retrieve attendance summary.");
  }
};

const getAttendanceOverviewService = async (options = {}) => {
  try {
    const checkInRange = buildCheckInRange(options.dateFrom, options.dateTo);
    if (checkInRange.error) return makeResult(400, checkInRange.error);
    const search = String(options.search || "").trim();
    if (search.length > 100) return makeResult(400, "Search must be 100 characters or fewer.");
    const liveReplacements = {};
    const periodReplacements = {};
    const searchClause = search ? " AND (u.full_name LIKE :search OR u.email LIKE :search)" : "";
    if (search) {
      liveReplacements.search = `%${search}%`;
      periodReplacements.search = `%${search}%`;
    }
    let periodClause = "";
    if (checkInRange.from) {
      periodClause += " AND a.check_in_time >= :dateFrom";
      periodReplacements.dateFrom = checkInRange.from;
    }
    if (checkInRange.to) {
      periodClause += " AND a.check_in_time < :dateTo";
      periodReplacements.dateTo = checkInRange.to;
    }
    const [liveRows, periodRows] = await Promise.all([
      sequelize.query(`SELECT COUNT(DISTINCT a.user_id) AS currently_checked_in_staff FROM attendances a INNER JOIN users u ON u.id = a.user_id WHERE u.role = 'staff' AND a.check_out_time IS NULL${searchClause}`, { replacements: liveReplacements, type: QueryTypes.SELECT }),
      sequelize.query(`SELECT COUNT(CASE WHEN a.check_out_time IS NOT NULL AND a.check_out_time >= a.check_in_time THEN 1 END) AS completed_session_count, COALESCE(SUM(CASE WHEN a.check_out_time IS NOT NULL AND a.check_out_time >= a.check_in_time THEN TIMESTAMPDIFF(MINUTE, a.check_in_time, a.check_out_time) ELSE 0 END), 0) AS total_worked_minutes, COUNT(DISTINCT a.user_id) AS staff_represented FROM attendances a INNER JOIN users u ON u.id = a.user_id WHERE u.role = 'staff'${searchClause}${periodClause}`, { replacements: periodReplacements, type: QueryTypes.SELECT }),
    ]);
    const live = liveRows[0] || {};
    const period = periodRows[0] || {};
    return makeResult(0, "Attendance overview retrieved successfully.", {
      currently_checked_in_staff: Number(live.currently_checked_in_staff || 0),
      completed_session_count: Number(period.completed_session_count || 0),
      total_worked_minutes: Number(period.total_worked_minutes || 0),
      staff_represented: Number(period.staff_represented || 0),
      current_snapshot_at: new Date().toISOString(),
      period: { date_from: options.dateFrom || null, date_to: options.dateTo || null },
      semantics: "Currently checked-in staff is a live snapshot. Completed sessions, worked minutes, and represented staff use the selected check-in date range; overnight shifts are not split.",
    });
  } catch (error) {
    console.error("Error retrieving attendance overview:", error);
    return makeResult(500, "Unable to retrieve attendance overview.");
  }
};

export {
  checkCurrentStatusService,
  checkInService,
  checkOutService,
  getAttendanceLogService,
  getAttendanceOverviewService,
  getAttendanceSummaryService,
  getOwnAttendanceHistoryService,
};
