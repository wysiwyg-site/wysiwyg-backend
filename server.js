const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());
app.use('/images', express.static(path.join(__dirname, 'images')));


const JWT_SECRET = "new_keyssqww"; // Replace with a strong secret (store in .env)
const JWT_EXPIRES_IN = '10m'; // Token valid for 10 minutes

function generateToken(user) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// Multer storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const projectId = req.params.project_id || req.body.project_id;
    if (!projectId) return cb(new Error("Project ID is required"));
    const folderPath = path.join(__dirname, 'images/projects', projectId);
    fs.mkdirSync(folderPath, { recursive: true });
    cb(null, folderPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  },
});

// Accept multiple fields including mainImage
const upload = multer({ storage }).fields([
  { name: 'mainImage', maxCount: 1 },
  { name: 'slider1', maxCount: 20 },
  { name: 'slider2', maxCount: 20 },
  { name: 'column1', maxCount: 20 },
  { name: 'column2', maxCount: 20 },
]);

// Helper function to build file paths

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === "admin" && password === "wysi@25") {
    const token = generateToken({ username });
    return res.json({ accessToken: token });
  }

  res.status(401).json({ error: "Invalid credentials" });
});

function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
   
  if (!token) return res.status(401).json({ error: "Missing token" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token" });
    req.user = user;
    next();
  });
}

const buildImagePaths = (projectId, files = []) =>
  files.map(file => `/images/projects/${projectId}/${file.filename}`);

// POST - Create new project
app.post("/projects", verifyToken, upload, (req, res) => {
  const {
    project_id,
    title,
    summaryTitle,
    projectDescription,
    question,
    answer,
    summary,
    meta,
    category,
    tags,
  } = req.body;

  const mainImageFile = req.files?.mainImage?.[0];
  const mainImagePath = mainImageFile
    ? `/images/projects/${project_id}/${mainImageFile.filename}`
    : '';

  const newProject = {
    project_id,
    title,
    summaryTitle,
    projectDescription,
    question,
    answer,
    summary,
    meta: JSON.parse(meta),
    category: JSON.parse(category),
    tags: JSON.parse(tags),
    mainImage: mainImagePath,
    images: {
      slider1: buildImagePaths(project_id, req.files?.slider1),
      slider2: buildImagePaths(project_id, req.files?.slider2),
      column1: buildImagePaths(project_id, req.files?.column1),
      column2: buildImagePaths(project_id, req.files?.column2),
    },
  };

  const portfolioPath = path.join(__dirname, 'portfolio.json');
  let portfolio = { projects: [] };

  if (fs.existsSync(portfolioPath)) {
    portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf-8'));
  }

  const existingIndex = portfolio.projects.findIndex(p => p.project_id === project_id);
  if (existingIndex !== -1) {
    portfolio.projects[existingIndex] = newProject;
  } else {
    portfolio.projects.push(newProject);
  }

  fs.writeFileSync(portfolioPath, JSON.stringify(portfolio, null, 2), 'utf-8');
  res.status(201).json({ message: 'Project added successfully', project: newProject });
});

// GET - Fetch all projects
app.get('/projects', (req, res) => {
  const filePath = path.join(__dirname, 'portfolio.json');

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading portfolio.json:', err);
      return res.status(500).json({ error: 'Failed to read portfolio data' });
    }

    try {
      const jsonData = JSON.parse(data);
      let projects = jsonData.projects || [];

      // ✅ Sort projects alphabetically by title (case-insensitive)
      projects.sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      );

      res.json(projects);
    } catch (parseError) {
      console.error('Error parsing JSON:', parseError);
      res.status(500).json({ error: 'Invalid JSON format' });
    }
  });
});

// PUT - Update existing project
app.put("/projects/:project_id", verifyToken, upload, (req, res) => {
  const { project_id } = req.params;
  const {
    title,
    summaryTitle,
    projectDescription,
    question,
    answer,
    summary,
    meta,
    category,
    tags,
    retainedImages,
  } = req.body;

  const portfolioPath = path.join(__dirname, 'portfolio.json');
  if (!fs.existsSync(portfolioPath)) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf-8'));
  const index = portfolio.projects.findIndex(p => p.project_id === project_id);
  if (index === -1) return res.status(404).json({ error: 'Project not found' });

  const oldImages = portfolio.projects[index].images || {};
  const retained = retainedImages ? JSON.parse(retainedImages) : {};

  const removed = {};

  for (const group of ['slider1', 'slider2', 'column1', 'column2']) {
    const prevGroup = oldImages[group] || [];
    const keepGroup = retained[group] || [];
    removed[group] = prevGroup.filter(img => !keepGroup.includes(img));

    removed[group].forEach((imgPath) => {
      const fullPath = path.join(__dirname, imgPath);
    
      // Check if this image is still used in any group of the same project
      const stillUsedInSameProject = Object.entries(oldImages).some(([g, images]) => {
        if (g === group) return false; // skip the current group being updated
        return images.includes(imgPath);
      });
    
      if (!stillUsedInSameProject && fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    });
  }

  function filterNewFiles(projectId, files = []) {
    const resultPaths = [];
  
    for (const file of files) {
      const destPath = path.join(__dirname, 'images/projects', projectId, file.originalname);
      if (fs.existsSync(destPath)) {
        // File already exists with same name, reference its existing path
        resultPaths.push(`/images/projects/${projectId}/${file.originalname}`);
        // Remove newly uploaded duplicate
        fs.unlinkSync(file.path);
      } else {
        // Rename current random-named upload to its original name
        const newFilePath = path.join(__dirname, 'images/projects', projectId, file.originalname);
        fs.renameSync(file.path, newFilePath);
        resultPaths.push(`/images/projects/${projectId}/${file.originalname}`);
      }
    }
  
    return resultPaths;
  }
  
  const newImages = {
    slider1: [...(retained.slider1 || []), ...filterNewFiles(project_id, req.files?.slider1)],
    slider2: [...(retained.slider2 || []), ...filterNewFiles(project_id, req.files?.slider2)],
    column1: [...(retained.column1 || []), ...filterNewFiles(project_id, req.files?.column1)],
    column2: [...(retained.column2 || []), ...filterNewFiles(project_id, req.files?.column2)],
  };

  // Handle mainImage upload
  const mainImageFile = req.files?.mainImage?.[0];
let newMainImage = portfolio.projects[index].mainImage;

if (mainImageFile) {
  // Delete old main image if it exists and is different
  const oldMainImagePath = path.join(__dirname, portfolio.projects[index].mainImage || "");
  if (
    portfolio.projects[index].mainImage &&
    fs.existsSync(oldMainImagePath)
  ) {
    fs.unlinkSync(oldMainImagePath);
  }

  // Set new image path
  newMainImage = `/images/projects/${project_id}/${mainImageFile.filename}`;
}

  portfolio.projects[index] = {
    ...portfolio.projects[index],
    title,
    summaryTitle,
    projectDescription,
    question,
    answer,
    summary,
    meta: meta ? JSON.parse(meta) : portfolio.projects[index].meta,
    category: category ? JSON.parse(category) : portfolio.projects[index].category,
    tags: tags ? JSON.parse(tags) : portfolio.projects[index].tags,
    images: newImages,
    mainImage: newMainImage,
  };

  fs.writeFileSync(portfolioPath, JSON.stringify(portfolio, null, 2), 'utf-8');
  res.json({ message: 'Project updated successfully', project: portfolio.projects[index] });
});

// DELETE - Remove a project
app.delete("/projects/:project_id", verifyToken, (req, res) => {
  const { project_id } = req.params;
  const portfolioPath = path.join(__dirname, 'portfolio.json');

  if (!fs.existsSync(portfolioPath)) {
    return res.status(404).json({ error: 'Portfolio not found' });
  }

  const portfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf-8'));
  const index = portfolio.projects.findIndex(p => p.project_id === project_id);
  if (index === -1) return res.status(404).json({ error: 'Project not found' });

  const [deletedProject] = portfolio.projects.splice(index, 1);

  const folderPath = path.join(__dirname, 'images/projects', project_id);
  if (fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
  }

  fs.writeFileSync(portfolioPath, JSON.stringify(portfolio, null, 2), 'utf-8');
  res.json({ message: 'Project deleted successfully', deleted: deletedProject });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});


app.get('/categories', (req, res) => {
  const filePath = path.join(__dirname, 'portfolio.json');

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading portfolio.json:', err);
      return res.status(500).json({ error: 'Failed to read portfolio data' });
    }

    try {
      const jsonData = JSON.parse(data);
      const categories = jsonData.categories || [];
      res.json(categories);
    } catch (parseError) {
      console.error('Error parsing JSON:', parseError);
      res.status(500).json({ error: 'Invalid JSON format' });
    }
  });
});