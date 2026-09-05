import { Op } from "sequelize";
import {
  CartItem,
  Category,
  OrderItem,
  Product,
  sequelize,
} from "../models/index.js";
import { removeManagedImageByUrl } from "./productImageService.js";
import { applyStockChange } from "./stockMovementService.js";

const getProducts = async (options = {}) => {
  try {
    const page = Math.max(Number.parseInt(options.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(Number.parseInt(options.limit, 10) || 9, 1),
      100,
    );
    const whereCondition = {};
    let orderCondition = [["createdAt", "DESC"], ["id", "DESC"]];

    if (options.category_id && options.category_id !== "all") {
      whereCondition.category_id = options.category_id;
    }

    if (typeof options.featured === "boolean") {
      whereCondition.is_featured = options.featured;
    }

    const keyword = String(options.search || "").trim().toLowerCase();
    if (keyword) {
      whereCondition.name = sequelize.where(
        sequelize.fn("LOWER", sequelize.col("Product.name")),
        "LIKE",
        `%${keyword}%`,
      );
    }

    if (options.sort === "price_asc") orderCondition = [["price", "ASC"], ["id", "ASC"]];
    if (options.sort === "price_desc") orderCondition = [["price", "DESC"], ["id", "DESC"]];

    const { count, rows } = await Product.findAndCountAll({
      where: whereCondition,
      order: orderCondition,
      limit,
      offset: (page - 1) * limit,
      include: [{ model: Category, attributes: ["name"] }],
      attributes: { exclude: ["updatedAt"] },
    });

    return {
      EM: "Get products successfully.",
      EC: 0,
      DT: {
        totalRows: count,
        totalPages: Math.ceil(count / limit),
        products: rows,
      },
    };
  } catch (error) {
    console.log("Error in getProducts service:", error);
    return { EM: "Unable to get products.", EC: 500, DT: [] };
  }
};

const findProductWithSameName = (name, excludedId = null) => {
  const where = sequelize.where(
    sequelize.fn("LOWER", sequelize.col("name")),
    String(name).toLowerCase(),
  );
  return Product.findOne({
    where: excludedId ? { [Op.and]: [where, { id: { [Op.ne]: excludedId } }] } : where,
  });
};

const createProduct = async (productData, actorId) => {
  const transaction = await sequelize.transaction();
  try {
    if (await findProductWithSameName(productData.name)) {
      await transaction.rollback();
      return { EM: "Product name already exists.", EC: 409, DT: "" };
    }

    if (!(await Category.findByPk(productData.category_id))) {
      await transaction.rollback();
      return { EM: "Category was not found.", EC: 404, DT: "" };
    }

    const initialStock = Number(productData.stock_quantity || 0);
    const product = await Product.create({ ...productData, stock_quantity: 0 }, { transaction });
    if (initialStock > 0) {
      await applyStockChange({ product, quantityChange: initialStock, type: "RESTOCK", referenceType: "PRODUCT", referenceId: product.id, note: "Initial stock recorded when the product was created.", actorId, transaction });
    }
    await transaction.commit();
    return { EM: "Product created successfully.", EC: 0, DT: product };
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    console.log("Error in createProduct service:", error);
    return { EM: "Unable to create product.", EC: 500, DT: "" };
  }
};

const updateProduct = async (id, productData) => {
  try {
    if (Object.prototype.hasOwnProperty.call(productData, "stock_quantity")) {
      return { EM: "Use Inventory to change product stock.", EC: 400, DT: "" };
    }
    const product = await Product.findByPk(id);
    if (!product) return { EM: "Product not found.", EC: 404, DT: "" };

    if (productData.name && await findProductWithSameName(productData.name, id)) {
      return { EM: "Product name already exists.", EC: 409, DT: "" };
    }

    if (productData.category_id && !(await Category.findByPk(productData.category_id))) {
      return { EM: "Category was not found.", EC: 404, DT: "" };
    }

    const previousImageUrl = product.image_url;
    const imageWasReplaced = Boolean(
      productData.image_url && productData.image_url !== previousImageUrl,
    );

    await product.update(productData);

    if (imageWasReplaced && previousImageUrl) {
      await removeManagedImageByUrl(previousImageUrl);
    }

    return { EM: "Product updated successfully.", EC: 0, DT: product };
  } catch (error) {
    console.log("Error in updateProduct service:", error);
    return { EM: "Unable to update product.", EC: 500, DT: "" };
  }
};

const deleteProduct = async (id) => {
  try {
    const product = await Product.findByPk(id);
    if (!product) return { EM: "Product not found.", EC: 404, DT: "" };

    const [orderReferences, cartReferences] = await Promise.all([
      OrderItem.count({ where: { product_id: id } }),
      CartItem.count({ where: { product_id: id } }),
    ]);

    if (orderReferences > 0 || cartReferences > 0) {
      return {
        EM: "This product is in an order or cart. Mark it unavailable instead of deleting it.",
        EC: 409,
        DT: "",
      };
    }

    const imageUrl = product.image_url;
    await product.destroy();
    if (imageUrl) await removeManagedImageByUrl(imageUrl);

    return { EM: "Product deleted successfully.", EC: 0, DT: { id } };
  } catch (error) {
    console.log("Error in deleteProduct service:", error);
    return { EM: "Unable to delete product.", EC: 500, DT: "" };
  }
};

export { getProducts, createProduct, updateProduct, deleteProduct };
