const fs = require('fs');
const path = require('path');

// Ensure build directory exists
const buildDir = path.join(__dirname, 'build');
if (!fs.existsSync(buildDir)) {
  console.error('❌ Build directory does not exist. Run "npm run build" first.');
  process.exit(1);
}

// Copy _redirects file (for Netlify)
const redirectsSource = path.join(__dirname, 'public', '_redirects');
const redirectsDest = path.join(__dirname, 'build', '_redirects');
if (fs.existsSync(redirectsSource)) {
  fs.copyFileSync(redirectsSource, redirectsDest);
  console.log('✅ _redirects file copied to build folder');
} else {
  console.warn('⚠️  _redirects file not found in public folder');
}

// Copy 404.html file (for GitHub Pages)
const notFoundSource = path.join(__dirname, 'public', '404.html');
const notFoundDest = path.join(__dirname, 'build', '404.html');
if (fs.existsSync(notFoundSource)) {
  fs.copyFileSync(notFoundSource, notFoundDest);
  console.log('✅ 404.html file copied to build folder');
} else {
  console.warn('⚠️  404.html file not found in public folder');
}

// Copy .htaccess file (for Apache servers)
const htaccessSource = path.join(__dirname, 'public', '.htaccess');
const htaccessDest = path.join(__dirname, 'build', '.htaccess');
if (fs.existsSync(htaccessSource)) {
  fs.copyFileSync(htaccessSource, htaccessDest);
  console.log('✅ .htaccess file copied to build folder');
} else {
  console.warn('⚠️  .htaccess file not found in public folder');
}

