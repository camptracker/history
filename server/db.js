import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URL || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/history';

export async function connectDB() {
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB connected');
}

const feedItemSchema = new mongoose.Schema({
  date: { type: String, required: true, index: true }, // YYYY-MM-DD
  type: { type: String, enum: ['video', 'book', 'fashion', 'ai_trend', 'history'], required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  summary: { type: String, default: '' },
  imageUrl: { type: String, default: null },
  links: [{ label: String, url: String }],
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
});

feedItemSchema.index({ date: 1, type: 1 });

export const FeedItem = mongoose.model('FeedItem', feedItemSchema);
