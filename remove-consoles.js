const fs = require('fs');
const path = require('path');

// Function to recursively find all .js files
function findJSFiles(dir, files = []) {
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory() && item !== 'node_modules') {
      findJSFiles(fullPath, files);
    } else if (stat.isFile() && path.extname(item) === '.js') {
      files.push(fullPath);
    }
  }

  return files;
}

// Function to remove console statements from a file
function removeConsoleStatements(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');

    // Remove all console statements (log, error, warn, info, debug)
    content = content.replace(/^\s*console\.(log|error|warn|info|debug)\s*\([^)]*\);\s*$/gm, '');

    // Remove empty lines that might be left behind
    content = content.replace(/^\s*$/gm, '');

    fs.writeFileSync(filePath, content, 'utf8');
    //(`Processed: ${filePath}`);
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
  }
}

// Main execution
const srcDir = path.join(__dirname, 'src');
//('Finding JavaScript files...');

const jsFiles = findJSFiles(srcDir);
//(`Found ${jsFiles.length} JavaScript files`);

//('Removing console statements...');
jsFiles.forEach(removeConsoleStatements);

//('Done! All console statements have been removed.');

