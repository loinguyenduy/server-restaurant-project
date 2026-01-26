import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

const UserCoupon = sequelize.define('UserCoupon', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    coupon_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    is_used: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
}, {
    tableName: 'user_coupons'
});
export default UserCoupon;