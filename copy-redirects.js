const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, 'public', '_redirects');
const dest = path.join(__dirname, 'build', '_redirects');

// Ensure build directory exists
const buildDir = path.join(__dirname, 'build');
if (!fs.existsSync(buildDir)) {
  console.error('❌ Build directory does not exist. Run "npm run build" first.');
  process.exit(1);
}

// Copy _redirects file
if (fs.existsSync(source)) {
  fs.copyFileSync(source, dest);
  console.log('✅ _redirects file copied to build folder');
} else {
  console.warn('⚠️  _redirects file not found in public folder');
}

