import { cloudinary } from "../config/cloudinaryConfig.js";

const getManagedPublicId = (imageUrl) => {
  if (!imageUrl) return null;

  try {
    const url = new URL(imageUrl);
    if (url.hostname !== "res.cloudinary.com") return null;

    const folderMarker = "/restaurant_products/";
    const markerIndex = url.pathname.indexOf(folderMarker);
    if (markerIndex === -1) return null;

    const assetPath = url.pathname.slice(markerIndex + 1);
    const publicId = assetPath.replace(/\.[^/.]+$/, "");
    return publicId.startsWith("restaurant_products/") ? publicId : null;
  } catch (error) {
    return null;
  }
};

const removeCloudinaryImage = async (publicId) => {
  if (!publicId) return false;

  try {
    await cloudinary.uploader.destroy(publicId);
    return true;
  } catch (error) {
    console.warn("Cloudinary image cleanup failed:", error.message);
    return false;
  }
};

const removeManagedImageByUrl = async (imageUrl) => {
  const publicId = getManagedPublicId(imageUrl);
  if (!publicId) return false;
  return removeCloudinaryImage(publicId);
};

export { getManagedPublicId, removeCloudinaryImage, removeManagedImageByUrl };
