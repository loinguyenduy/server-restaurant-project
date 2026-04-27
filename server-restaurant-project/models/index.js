import { sequelize } from "../config/databaseConfig.js";
import User from "./userModel.js";
import Attendance from "./attendanceModel.js";
import Category from "./categoryModel.js";
import Product from "./productModel.js";
import Order from "./orderModel.js";
import OrderItem from "./orderItemModel.js";
import Cart from "./cartModel.js";
import CartItem from "./cartItem.js";
import Table from "./tableModel.js";
import Reservation from "./reservationModel.js";
import Coupon from "./couponModel.js";
import UserCoupon from "./userCouponModel.js";

// 1. User - Order (1:N)
User.hasMany(Order, { foreignKey: "user_id" });
Order.belongsTo(User, { foreignKey: "user_id" });

// 2. User - Attendance (1:N)
User.hasMany(Attendance, { foreignKey: "user_id" });
Attendance.belongsTo(User, { foreignKey: "user_id" });

// 3. User - Reservation (1:N)
User.hasMany(Reservation, { foreignKey: "user_id" });
Reservation.belongsTo(User, { foreignKey: "user_id" });

// 4. User - Cart (1:1)
User.hasOne(Cart, { foreignKey: "user_id" });
Cart.belongsTo(User, { foreignKey: "user_id" });

// 5. Category - Product (1:N)
Category.hasMany(Product, { foreignKey: "category_id" });
Product.belongsTo(Category, { foreignKey: "category_id" });

// 6. Table - Order (1:N)
Table.hasMany(Order, { foreignKey: "table_id" });
Order.belongsTo(Table, { foreignKey: "table_id" });

// 7. Table - Reservation (1:N)
Table.hasMany(Reservation, { foreignKey: "table_id" });
Reservation.belongsTo(Table, { foreignKey: "table_id" });

// 8. Order - OrderItem (1:N)
Order.hasMany(OrderItem, { foreignKey: "order_id", onDelete: "CASCADE" });
OrderItem.belongsTo(Order, { foreignKey: "order_id" });

// 9. Product - OrderItem (1:N)
Product.hasMany(OrderItem, { foreignKey: "product_id" });
OrderItem.belongsTo(Product, { foreignKey: "product_id" });

// 10. Cart - CartItem (1:N)
Cart.hasMany(CartItem, { foreignKey: "cart_id", onDelete: "CASCADE" });
CartItem.belongsTo(Cart, { foreignKey: "cart_id" });

// 11. Product - CartItem (1:N)
Product.hasMany(CartItem, { foreignKey: "product_id" });
CartItem.belongsTo(Product, { foreignKey: "product_id" });

// 12. User - Coupon (N:N qua UserCoupon)
User.belongsToMany(Coupon, { through: UserCoupon, foreignKey: "user_id" });
Coupon.belongsToMany(User, { through: UserCoupon, foreignKey: "coupon_id" });

export {
  sequelize,
  User,
  Attendance,
  Category,
  Product,
  Order,
  OrderItem,
  Cart,
  CartItem,
  Table,
  Reservation,
  Coupon,
  UserCoupon,
};
