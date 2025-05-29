const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },

  role: { 
    type: String, 
    enum: ['superadmin', 'admin', 'employee', 'candidate'], 
    default: 'candidate' 
  },

  // Approval status: pending, approved, rejected
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected'], 
    default: function () {
      if (this.role === 'candidate') return 'approved';
      if (this.role === 'superadmin') return 'approved'; // auto-approve superadmin
      return 'pending';
    }
  },

  // Track who approved this user
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // For employees: company reference
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // For employees: their job position (e.g., 'Frontend Developer', 'HR')
  position: { type: String, trim: true, default: '' },

  // For candidates: email verified status
  emailVerified: {
    type: Boolean,
    default: function () {
      return this.role === 'superadmin' ? true : false;
    }
  },

  createdAt: { type: Date, default: Date.now },
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);
