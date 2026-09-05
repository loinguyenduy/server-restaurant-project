import multer from 'multer';
import { storage } from '../config/cloudinaryConfig.js';

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const allowedMimeTypes = ["image/jpeg", "image/png"];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return callback(new Error("Only JPG and PNG images are allowed."));
    }
    return callback(null, true);
  },
});

const uploadProductImage = (req, res, next) => {
  upload.single("image")(req, res, (error) => {
    if (!error) return next();

    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Product image must be 5 MB or smaller."
      : error.message || "Unable to upload product image.";

    return res.status(400).json({ EM: message, EC: 400, DT: "" });
  });
};

export default uploadProductImage;
