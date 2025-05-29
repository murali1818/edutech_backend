const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authUser, authRole } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EMAIL_SECRET = process.env.JWT_EMAIL_SECRET;

// Utility: Simulate sending email verification
const sendEmailVerification = async (user, token) => {
  const verificationURL = `http://localhost:5000/api/verify-email/${token}`;
  console.log(`Simulated email sent to ${user.email} with link: ${verificationURL}`);
};

// Candidate email verification endpoint
// Backend: /routes/auth.js
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const decoded = jwt.verify(token, process.env.JWT_EMAIL_SECRET);

    const user = await User.findById(decoded.userId);
    if (!user) return res.redirect('http://localhost:5173/verify-failed');

    user.emailVerified = true;
    await user.save();

    return res.redirect('http://localhost:5173/verify-success'); // redirect to frontend success page
  } catch (err) {
    console.error('Email Verification Error:', err);
    return res.redirect('http://localhost:5173/verify-failed');
  }
});

// Company (Admin) registration
router.post('/register/company', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ error: 'All fields are required' });

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ error: 'Email already registered' });

    const newUser = new User({
      name,
      email,
      password,
      role: 'admin', // still company, but will be approved by superadmin
      status: 'pending',
      emailVerified: false,
    });

    await newUser.save();

    // Generate email verification token
    const emailToken = jwt.sign({ userId: newUser._id }, JWT_EMAIL_SECRET, { expiresIn: '1d' });

    // Send the verification email
    await sendEmailVerification(newUser, emailToken);

    res.status(201).json({
      message: 'Company registered successfully. Please verify your email.',
      emailVerificationLink: `http://localhost:5000/api/verify-email/${emailToken}`,
    });
  } catch (err) {
    console.error('Company Register Error:', err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// Employee registration (only by company)
router.post('/register/employee', authUser, authRole(['admin']), async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields are required' });

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already registered' });

    const newUser = new User({
      name,
      email,
      password,
      role: 'employee',
      status: 'pending',
      companyId: req.user._id,
    });

    await newUser.save();
    res.status(201).json({ message: 'Employee registered successfully and is pending Company approval.' });
  } catch (err) {
    console.error('Employee Register Error:', err);
    res.status(500).json({ error: 'Server error during employee registration.' });
  }
});

// Candidate registration (email verification required)
router.post('/register/candidate', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields are required' });

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already registered' });

    const newUser = new User({
      name,
      email,
      password,
      role: 'candidate',
      status: 'approved',
      emailVerified: false,
    });

    await newUser.save();

    const emailToken = jwt.sign({ userId: newUser._id }, JWT_EMAIL_SECRET, { expiresIn: '1d' });
    await sendEmailVerification(newUser, emailToken);

    res.status(201).json({
      message: 'Candidate registered successfully. Please verify your email to login.',
      emailVerificationLink: `http://localhost:5000/api/verify-email/${emailToken}`,
    });
  } catch (err) {
    console.error('Candidate Register Error:', err);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// Login (all users)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid email or password.' });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid email or password.' });

    // 🚫 Check email verification for ALL users
    if (!user.emailVerified) {
      const emailToken = jwt.sign({ userId: user._id }, process.env.JWT_EMAIL_SECRET, { expiresIn: '1d' });
      return res.status(403).json({
        error: 'Please verify your email before logging in.',
        emailVerified: false,
        emailVerificationLink: `http://localhost:5000/api/verify-email/${emailToken}`
      });
    }

    // 🚫 Restrict admin login if not approved
    if (user.role === 'admin' && user.status !== 'approved') {
      return res.status(403).json({
        error: 'Your company registration is pending Super Admin approval.',
        status: user.status
      });
    }

    // ✅ All checks passed - create token
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: '1d',
    });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        status: user.status
      }
    });

  } catch (err) {
    console.error('Login Error:', err.message);
    res.status(500).json({ error: 'Server error during login.' });
  }
});


// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

// Super Admin: Approve Company
router.post('/approve/company/:companyId', authUser, authRole(['superadmin']), async (req, res) => {
  try {
    const company = await User.findById(req.params.companyId);
    if (!company || company.role !== 'admin') return res.status(404).json({ error: 'Company not found' });

    company.status = 'approved';
    company.approvedBy = req.user._id;
    await company.save();

    res.json({ message: 'Company approved successfully.' });
  } catch (err) {
    console.error('Company Approval Error:', err);
    res.status(500).json({ error: 'Server error during company approval.' });
  }
});

// Get pending approvals (SuperAdmin for companies)
router.get('/pending/companies', authUser, authRole(['superadmin']), async (req, res) => {
  try {
    const pendingCompanies = await User.find({ role: 'admin', status: 'pending' }).select('name email createdAt');
    res.json({ pendingCompanies });
  } catch (err) {
    console.error('Get Pending Companies Error:', err);
    res.status(500).json({ error: 'Server error fetching pending companies.' });
  }
});

// Get approved companies (SuperAdmin view)
router.get('/approved/companies', authUser, authRole(['superadmin']), async (req, res) => {
  try {
    const approvedCompanies = await User.find({ role: 'admin', status: 'approved' }).select('name email createdAt');
    res.json({ approvedCompanies });
  } catch (err) {
    console.error('Get Approved Companies Error:', err);
    res.status(500).json({ error: 'Server error fetching approved companies.' });
  }
});

// POST /create/employee - Only for Admins
router.post('/create/employee', authUser, authRole(['admin']), async (req, res) => {
  try {
    const { name, email, password, position } = req.body;

    // Basic field validation
    if (!name || !email || !password || !position) {
      return res.status(400).json({ error: 'Name, email, password, and position are required.' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists.' });
    }

    // Create employee user
    const employee = new User({
      name,
      email,
      password,
      role: 'employee',
      status: 'approved',        // auto-approved
      emailVerified: true,       // skip email verification
      companyId: req.user._id,   // link to admin company
    });

    // Optional: add position if your schema supports it (or store it elsewhere)
    if (position) {
      employee.position = position;
    }

    await employee.save();

    res.status(201).json({
      message: 'Employee account created successfully.',
      employee: {
        id: employee._id,
        name: employee.name,
        email: employee.email,
        role: employee.role,
        companyId: employee.companyId,
      }
    });

  } catch (err) {
    console.error('Create Employee Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /company/employees - Admin can view their employees
router.get('/company/employees', authUser, authRole(['admin']), async (req, res) => {
  try {
    const employees = await User.find({ 
      role: 'employee',
      companyId: req.user._id 
    }).select('-password'); // exclude password

    res.json({ employees });
  } catch (err) {
    console.error('Fetch Employees Error:', err.message);
    res.status(500).json({ error: 'Server error while fetching employees.' });
  }
});

// PUT /update/employee/:id - Only Admins
router.put('/update/employee/:id', authUser, authRole(['admin']), async (req, res) => {
  try {
    const { name, password, position } = req.body;
    const employeeId = req.params.id;

    const employee = await User.findOne({ _id: employeeId, role: 'employee', companyId: req.user._id });
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found or not part of your company.' });
    }

    if (name) employee.name = name;
    if (position) employee.position = position;
    if (password) employee.password = password; // Hashing will depend on your User model pre-save hook

    await employee.save();

    res.status(200).json({ message: 'Employee updated successfully', employee });
  } catch (err) {
    console.error('Update Employee Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /delete/employee/:id - Only Admins
router.delete('/delete/employee/:id', authUser, authRole(['admin']), async (req, res) => {
  try {
    const employeeId = req.params.id;

    const employee = await User.findOneAndDelete({ _id: employeeId, role: 'employee', companyId: req.user._id });
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found or not part of your company.' });
    }

    res.status(200).json({ message: 'Employee deleted successfully' });
  } catch (err) {
    console.error('Delete Employee Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// Create superadmin route (use only once, then disable or protect!)
router.post('/create-superadmin', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Basic validation
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Check if superadmin already exists
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Superadmin already exists with this email' });
    }

    // Create user with role superadmin
    const superAdmin = new User({
      name,
      email,
      password, // ✅ Plain text — will be hashed automatically by the model
      role: 'superadmin',
      emailVerified: true,
      status: 'approved',
    });

    await superAdmin.save();
    res.status(201).json({ message: 'Superadmin created successfully' });
  } catch (error) {
    console.error('Superadmin creation error:', error);
    res.status(500).json({ error: 'Server error during superadmin creation' });
  }
});

// Get all approved admins - Only for SuperAdmin
router.get('/admins', authUser, authRole(['superadmin']), async (req, res) => {
  try {
    const admins = await User.find({ role: 'admin', status: 'approved' })
      .select('name email createdAt status');

    res.json({ admins });
  } catch (err) {
    console.error('Get All Admins Error:', err);
    res.status(500).json({ error: 'Server error fetching admin list.' });
  }
});

// PUT /admins/:adminId - Superadmin edits an approved admin
router.put('/admins/:adminId', authUser, authRole(['superadmin']), async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const admin = await User.findOne({ _id: req.params.adminId, role: 'admin' });
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found.' });
    }

    if (name) admin.name = name;
    if (email) admin.email = email;
    if (password) admin.password = password; // This will be hashed automatically via the pre-save hook

    await admin.save();

    res.status(200).json({ message: 'Admin updated successfully.', admin });
  } catch (err) {
    console.error('Edit Admin Error:', err.message);
    res.status(500).json({ error: 'Server error editing admin.' });
  }
});


// DELETE /admin/:adminId - Superadmin deletes an approved admin
router.delete('/admins/:adminId', authUser, authRole(['superadmin']), async (req, res) => {
  try {
    const admin = await User.findOneAndDelete({ _id: req.params.adminId, role: 'admin' });

    if (!admin) {
      return res.status(404).json({ error: 'Admin not found or already deleted.' });
    }

    res.json({ message: 'Admin deleted successfully.' });
  } catch (err) {
    console.error('Delete Admin Error:', err);
    res.status(500).json({ error: 'Server error deleting admin.' });
  }
});



// Get all approved users (excluding superadmins)
router.get('/all', authUser, authRole(['superadmin']), async (req, res) => {
  try {
    const users = await User.find({
      role: { $ne: 'superadmin' },
      status: 'approved'
    }).select('name email role status companyId createdAt');

    res.json({ users });
  } catch (err) {
    console.error('Get All Users Error:', err);
    res.status(500).json({ error: 'Server error fetching user list.' });
  }
});

module.exports = router;