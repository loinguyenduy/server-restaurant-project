import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

const Reservation = sequelize.define('Reservation', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    table_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    reservation_time: {
        type: DataTypes.DATE,
        allowNull: false
    },
    number_of_people: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('pending', 'confirmed', 'cancelled', 'completed'),
        defaultValue: 'pending'
    }
}, {
    tableName: 'reservations'
});

export default Reservation;