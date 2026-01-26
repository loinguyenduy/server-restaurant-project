import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

const Coupon = sequelize.define('Coupon', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    code: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    discount_value: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    discount_type: {
        type: DataTypes.ENUM('percent', 'fixed'),
        allowNull: false
    },
    expiry_date: {
        type: DataTypes.DATE,
        allowNull: false
    },
    quantity_limit: {
        type: DataTypes.INTEGER,
        allowNull: true 
    }
}, {
    tableName: 'coupons'
});

export default Coupon;