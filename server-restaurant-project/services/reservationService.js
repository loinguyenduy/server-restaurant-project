import { Reservation, Table } from "../models/index.js";
import { Op } from "sequelize";

const checkAvailabilityService = async (date, partySize) => {
    try {
        // 1. Tính tổng sức chứa của nhà hàng
        const totalCapacityResult = await Table.sum('capacity');
        const totalSeats = totalCapacityResult || 0; // Đề phòng chưa có bàn nào

        // 2. Định nghĩa các khung giờ phục vụ (Mảng các string 'HH:mm')
        const lunchSlots = ['11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00'];
        const dinnerSlots = ['17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'];
        const allSlots = [...lunchSlots, ...dinnerSlots];

        // 3. Xác định mốc đầu và cuối của ngày hôm đó để query DB
        const startDate = new Date(`${date}T00:00:00.000Z`);
        const endDate = new Date(`${date}T23:59:59.999Z`);

        // Lấy toàn bộ Reservation của ngày hôm đó (Bỏ qua các đơn đã bị hủy hoặc khách đã ăn xong)
        const existingReservations = await Reservation.findAll({
            where: {
                reservation_time: {
                    [Op.between]: [startDate, endDate]
                },
                status: {
                    [Op.notIn]: ['cancelled', 'completed']
                }
            }
        });

        // 4. Thuật toán quét từng khung giờ
        const availableSlots = allSlots.map(slotTime => {
            // Biến đổi slotTime ('13:00') thành object Date hoàn chỉnh để so sánh
            const currentSlotDate = new Date(`${date}T${slotTime}:00.000Z`);
            let occupiedSeats = 0;

            // Kiểm tra xem tại thời điểm currentSlotDate này, có bao nhiêu người đang ngồi
            existingReservations.forEach(res => {
                const resTime = new Date(res.reservation_time);
                // Thời điểm khách ăn xong = Giờ đặt + 2 tiếng (120 phút * 60000ms)
                const resEndTime = new Date(resTime.getTime() + 120 * 60000); 

                // Nếu slot hiện tại nằm trong khoảng khách đang ăn, thì cộng dồn số ghế
                if (currentSlotDate >= resTime && currentSlotDate < resEndTime) {
                    occupiedSeats += res.number_of_people;
                }
            });

            // Nếu số ghế trống còn lại đủ cho nhóm khách này -> available
            const isAvailable = (totalSeats - occupiedSeats) >= partySize;

            return {
                time: slotTime,
                status: isAvailable ? 'available' : 'booked',
                type: lunchSlots.includes(slotTime) ? 'lunch' : 'dinner'
            };
        });

        return {
            EC: 0,
            EM: "Get available slots successfully",
            DT: availableSlots
        };

    } catch (error) {
        console.error(">>> Error in checkAvailabilityService:", error);
        return { EC: 500, EM: "Internal server error", DT: [] };
    }
};

const createReservationService = async (userId, bookingData) => {
    try {
        const { date, time, partySize, contact_name, contact_phone, note } = bookingData;

        // 1. Tạo Date object cho thời điểm đặt bàn
        // Lưu ý: Cần đảm bảo timezone hợp lý. Ở đây đang dùng chuẩn ISO (Z)
        const reservationTime = new Date(`${date}T${time}:00.000Z`);
        const reservationEndTime = new Date(reservationTime.getTime() + 120 * 60000); // +2 tiếng

        // 2. DOUBLE CHECK: Lấy tổng sức chứa
        const totalCapacityResult = await Table.sum('capacity');
        const totalSeats = totalCapacityResult || 0;

        // 3. Lấy các đơn đặt bàn trong cùng ngày
        const startDate = new Date(`${date}T00:00:00.000Z`);
        const endDate = new Date(`${date}T23:59:59.999Z`);

        const existingReservations = await Reservation.findAll({
            where: {
                reservation_time: {
                    [Op.between]: [startDate, endDate]
                },
                status: {
                    [Op.notIn]: ['cancelled', 'completed']
                }
            }
        });

        // 4. Tính toán số ghế bị chiếm TẠI ĐÚNG KHUNG GIỜ KHÁCH ĐANG ĐẶT
        let occupiedSeats = 0;
        existingReservations.forEach(res => {
            const resTime = new Date(res.reservation_time);
            const resEndTime = new Date(resTime.getTime() + 120 * 60000); 

            // Logic Overlap (Trùng lịch): 
            // Hai khoảng thời gian trùng nhau nếu: Bắt đầu của A < Kết thúc của B VÀ Kết thúc của A > Bắt đầu của B
            if (reservationTime < resEndTime && reservationEndTime > resTime) {
                occupiedSeats += res.number_of_people;
            }
        });

        // 5. Kiểm tra nếu không đủ chỗ
        if ((totalSeats - occupiedSeats) < partySize) {
            return {
                EC: 400,
                EM: "Sorry, this time slot has just been fully booked. Please choose another time.",
                DT: ""
            };
        }

        // 6. Nếu đủ chỗ, tiến hành tạo đơn
        const newReservation = await Reservation.create({
            user_id: userId,
            reservation_time: reservationTime,
            number_of_people: partySize,
            contact_name: contact_name,
            contact_phone: contact_phone,
            note: note || "",
            status: "pending" // Chờ nhân viên check-in khi khách đến
        });

        return {
            EC: 0,
            EM: "Table reserved successfully",
            DT: newReservation
        };

    } catch (error) {
        console.error(">>> Error in createReservationService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

const getUserReservationsService = async (userId) => {
    try {
        const reservations = await Reservation.findAll({
            where: { user_id: userId },
            order: [['reservation_time', 'DESC']] // Xếp đơn mới nhất (hoặc sắp tới) lên đầu
        });

        if (!reservations || reservations.length === 0) {
            return { EC: 404, EM: "No reservations found", DT: [] };
        }

        return {
            EC: 0,
            EM: "Get user reservations successfully",
            DT: reservations
        };
    } catch (error) {
        console.error(">>> Error in getUserReservationsService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

// Khách hàng tự hủy đặt bàn
const cancelReservationService = async (userId, reservationId) => {
    try {
        const reservation = await Reservation.findOne({
            where: { 
                id: reservationId,
                user_id: userId 
            }
        });

        if (!reservation) {
            return { EC: 404, EM: "Reservation not found or unauthorized", DT: "" };
        }

        // Kiểm tra trạng thái
        if (reservation.status === 'cancelled' || reservation.status === 'completed') {
            return { 
                EC: 400, 
                EM: `Cannot cancel a reservation that is already ${reservation.status}`, 
                DT: "" 
            };
        }

        // Kiểm tra thời gian: Không cho hủy nếu đã quá giờ hẹn
        const now = new Date();
        const resTime = new Date(reservation.reservation_time);
        if (now > resTime) {
            return { 
                EC: 400, 
                EM: "Cannot cancel a reservation from the past. Please contact support.", 
                DT: "" 
            };
        }

        // Tiến hành hủy
        await reservation.update({ status: 'cancelled' });

        return {
            EC: 0,
            EM: "Reservation cancelled successfully",
            DT: ""
        };

    } catch (error) {
        console.error(">>> Error in cancelReservationService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

const getAllReservationsService = async (options) => {
    try {
        const { page, limit, status, date } = options;
        let whereCondition = {};
        let offset = (page - 1) * limit;

        if (status && status !== 'all') {
            whereCondition.status = status;
        }

        // Lọc theo ngày cụ thể (để Staff xem hôm nay có bao nhiêu khách đặt)
        if (date) {
            const startDate = new Date(`${date}T00:00:00.000Z`);
            const endDate = new Date(`${date}T23:59:59.999Z`);
            whereCondition.reservation_time = {
                [Op.between]: [startDate, endDate]
            };
        }

        const { count, rows } = await Reservation.findAndCountAll({
            where: whereCondition,
            order: [['reservation_time', 'ASC']], // Ưu tiên giờ gần nhất lên đầu
            limit: +limit,
            offset: +offset
        });

        let totalPages = Math.ceil(count / limit);

        return {
            EC: 0,
            EM: "Get all reservations successfully",
            DT: {
                totalRows: count,
                totalPages: totalPages,
                reservations: rows
            }
        };
    } catch (error) {
        console.error(">>> Error in getAllReservationsService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

const updateReservationStatusService = async (reservationId, newStatus) => {
    try {
        const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
        if (!validStatuses.includes(newStatus)) {
            return { EC: 400, EM: "Invalid reservation status", DT: "" };
        }

        const reservation = await Reservation.findOne({ where: { id: reservationId } });
        if (!reservation) {
            return { EC: 404, EM: "Reservation not found", DT: "" };
        }
        // console.log(reservation.status);
        // --- CHỐT CHẶN BẢO VỆ ---
        if (reservation.status === 'completed' || reservation.status === 'cancelled') {
            return { 
                EC: 403, 
                EM: `This reservation is already ${reservation.status} and cannot be modified.`, 
                DT: "" 
            };
        }

        await reservation.update({ status: newStatus });

        return {
            EC: 0,
            EM: `Reservation status updated to ${newStatus} successfully`,
            DT: ""
        };
    } catch (error) {
        console.error(">>> Error in updateReservationStatusService:", error);
        return { EC: 500, EM: "Internal server error", DT: "" };
    }
};

export { 
    checkAvailabilityService, createReservationService, getUserReservationsService, cancelReservationService,
    getAllReservationsService, updateReservationStatusService 
};