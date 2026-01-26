import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

const Order = sequelize.define('Order', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    table_id: {
        type: DataTypes.UUID,
        allowNull: true
    },
    user_coupon_id: {
        type: DataTypes.BIGINT, 
        allowNull: true
    },
    type: {
        type: DataTypes.ENUM('online', 'offline'),
        allowNull: false
    },
    total_amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    discount_amount: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },
    shipping_fee: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },
    tax_price: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0
    },
    final_amount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    payment_status: {
        type: DataTypes.STRING,
        defaultValue: 'pending'
    },
    payment_method: {
        type: DataTypes.ENUM('cash', 'card'),
        defaultValue: 'cash'
    },
    address: {
        type: DataTypes.STRING,
        allowNull: true
    },
    phone_receiver: {
        type: DataTypes.STRING,
        allowNull: true
    },
    note: {
        type: DataTypes.STRING,
        allowNull: true
    },
    order_status: {
        type: DataTypes.ENUM('pending', 'processing', 'completed', 'cancelled'),
        defaultValue: 'pending'
    }
}, {
    tableName: 'orders'
});

export default Order;