const express = require('express');
const Job = require('../models/jobs');
const User = require('../models/User');
const { authUser, authRole } = require('../middleware/auth');

const router = express.Router();

// Post a job (Admin/SuperAdmin only)
router.post('/postjob', authUser, authRole(['admin', 'superadmin', 'employee']), async (req, res) => {
  try {
    const { title, description, company, location, salaryRange, jobType } = req.body;

    const job = new Job({
      title,
      description,
      company,
      location,
      salaryRange,
      jobType,
      postedBy: req.user._id,
    });

    await job.save();
    res.status(201).json({ message: 'Job posted successfully', job });
  } catch (err) {
    console.error('Post Job Error:', err.message);
    res.status(500).json({ error: 'Server error while posting job.' });
  }
});

// Apply to a job (User only)
router.post('/:id/apply', authUser, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.applicants.includes(req.user._id)) {
      return res.status(400).json({ error: 'Already applied' });
    }

    job.applicants.push(req.user._id);
    await job.save();

    res.json({ message: 'Applied successfully' });
  } catch (err) {
    console.error('Apply Error:', err.message);
    res.status(500).json({ error: 'Server error while applying' });
  }
});

// Get all jobs based on role
router.get('/all', authUser, async (req, res) => {
  try {
    let jobs;

    if (req.user.role === 'candidate') {
      // Normal candidate sees all active jobs
      jobs = await Job.find({ isActive: true }).populate('postedBy', 'name email role');
    } else if (req.user.role === 'admin' || req.user.role === 'employee') {
      let companyId;

      if (req.user.role === 'admin') {
        // Admin's own _id acts as companyId
        companyId = req.user._id;
      } else if (req.user.role === 'employee') {
        companyId = req.user.companyId;
      }

      if (!companyId) {
        return res.status(400).json({ error: 'Company ID not found.' });
      }

      // Fetch all users who belong to this company + the admin themself
      const companyUsers = await User.find({
        $or: [
          { _id: companyId }, // the admin
          { companyId }       // employees
        ]
      }).select('_id');

      const userIds = companyUsers.map(user => user._id);

      jobs = await Job.find({ isActive: true, postedBy: { $in: userIds } })
        .populate('postedBy', 'name email role');
    } else {
      return res.status(403).json({ error: 'Unauthorized role' });
    }

    res.json({ jobs });
  } catch (err) {
    console.error('Get All Jobs Error:', err);
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

router.put('/:jobId', authUser, authRole(['admin', 'employee']), async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const userId = req.user._id;

    let allowedUserIds = [userId];

    if (req.user.role === 'employee' && req.user.companyId) {
      allowedUserIds.push(req.user.companyId);
    }

    const job = await Job.findOne({ _id: jobId, postedBy: { $in: allowedUserIds } });
    if (!job) {
      return res.status(404).json({ error: 'Job not found or no permission.' });
    }

    const { title, description, company, location, jobType, isActive } = req.body;

    if (title !== undefined) job.title = title;
    if (description !== undefined) job.description = description;
    if (company !== undefined) job.company = company;
    if (location !== undefined) job.location = location;
    if (jobType !== undefined) job.jobType = jobType;
    if (isActive !== undefined) job.isActive = isActive;

    await job.save();
    res.status(200).json({ message: 'Job updated successfully.', job });
  } catch (err) {
    console.error('Update Job Error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

router.delete('/:jobId', authUser, authRole(['admin', 'employee']), async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const userId = req.user._id;

    let allowedUserIds = [userId];
    if (req.user.role === 'employee' && req.user.companyId) {
      allowedUserIds.push(req.user.companyId);
    }

    const job = await Job.findOne({ _id: jobId, postedBy: { $in: allowedUserIds } });
    if (!job) {
      return res.status(404).json({ error: 'Job not found or no permission.' });
    }

    await job.deleteOne(); // preferred over deprecated .remove()

    res.status(200).json({ message: 'Job deleted successfully.' });
  } catch (err) {
    console.error('Delete Job Error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});


// Get current user
router.get('/me', authUser, (req, res) => {
  const { name, email, role } = req.user;
  res.json({ user: { name, email, role } });
});

module.exports = router;
