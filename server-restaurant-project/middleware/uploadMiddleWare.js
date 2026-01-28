import multer from 'multer';
import { storage } from '../config/cloudinaryConfig.js';

const upload = multer({ storage: storage });

export default upload;