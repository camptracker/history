import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/history';

export async function connectDB() {
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB connected');
}

const eventSchema = new mongoose.Schema({
  date: { type: String, required: true, index: true },   // "MM-DD"
  year: { type: String },
  text: { type: String, required: true },
  pages: [{ title: String, thumbnail: String, url: String }],
  type: { type: String, enum: ['event', 'birth', 'death'], default: 'event' },
}, { timestamps: true });

eventSchema.index({ date: 1, year: 1, type: 1 }, { unique: true });

const dayMetaSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true },  // "MM-DD"
  generatedAt: { type: Date, default: Date.now },
  eventCount: Number,
});

export const HistoryEvent = mongoose.model('HistoryEvent', eventSchema);
export const DayMeta = mongoose.model('DayMeta', dayMetaSchema);
