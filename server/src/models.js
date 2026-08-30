/**
 * Skema Mongoose — User, Attendance, Office (singleton konfigurasi).
 */
import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 3 },
    employeeId: { type: String, required: true, unique: true, uppercase: true, trim: true },
    pinHash: { type: String, required: true },
    role: { type: String, enum: ["employee", "admin"], default: "employee" },
    /** Foto tanda tangan. Demo = base64; produksi = URL S3 (lihat README). */
    photo: { type: String, default: null },
    /** 128 angka — embedding wajah (dihasilkan klien via face-api.js). */
    descriptor: { type: [Number], default: null, validate: (v) => !v || v.length === 128 },
  },
  { timestamps: true }
);

const AttendanceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  userName: String,
  employeeId: String,
  type: { type: String, enum: ["in", "out"], required: true },
  timestamp: { type: Date, default: Date.now, index: true },
  coords: {
    lat: Number,
    lng: Number,
    accuracy: Number,
  },
  distanceM: Number, // jarak ke kantor saat absen
  faceDistance: Number, // jarak Euclidean descriptor
  photo: { type: String, default: null },
  simulated: { type: Boolean, default: false },
});

const OfficeSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    radiusM: { type: Number, required: true, min: 10, max: 5000 },
    demoGps: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", UserSchema);
export const Attendance = mongoose.model("Attendance", AttendanceSchema);
export const Office = mongoose.model("Office", OfficeSchema);
