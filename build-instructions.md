# Production Build Instructions for GitHub Pages

## Important: GitHub Pages Routing Configuration

After building, make sure the following files are in your `build` folder:

1. **404.html** - Must be identical to `index.html` with the routing script
2. **index.html** - Must include the routing script in the `<head>`
3. **.htaccess** - For Apache servers (if not using GitHub Pages)

## Build Steps

1. Build the app:
   ```bash
   npm run build
   ```

2. Verify these files exist in `build/`:
   - `build/index.html` (with routing script)
   - `build/404.html` (with routing script)
   - `build/.htaccess` (optional, for Apache)

3. Deploy the `build` folder contents to GitHub Pages

## GitHub Pages Setup

1. Go to your repository Settings → Pages
2. Source: Select "Deploy from a branch"
3. Branch: Select your branch (usually `main` or `gh-pages`)
4. Folder: Select `/ (root)` or `/build` depending on your setup

## Troubleshooting

If routes still don't work after refresh:

1. Check that `404.html` exists in your build folder
2. Verify `404.html` contains the routing script
3. Clear browser cache and try again
4. Check browser console for errors

## For Custom Domains

If using a custom domain, you may need to:
- Set `pathSegmentsToKeep = 0` in `404.html`
- Ensure your domain's DNS is configured correctly
- Check that GitHub Pages custom domain is enabled


