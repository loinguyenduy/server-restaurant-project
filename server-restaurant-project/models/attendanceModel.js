import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

const Attendance = sequelize.define('Attendance', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    check_in_time: {
        type: DataTypes.DATE, 
        allowNull: false
    },
    check_out_time: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'attendances'
});
export default  Attendance;