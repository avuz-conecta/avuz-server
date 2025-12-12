# Avuz Theme App

Custom branding and login layout for Avuz Conecta.

## Features

- Split-screen login layout (70/30 ratio)
- Network diagram on the left panel (70% width)
- Login form on the right panel (30% width) in a unified white card
- Two logos integrated into the white form card
- Custom Avuz color scheme
- Fully responsive (mobile and tablet friendly)
- 100% update-safe (no core file modifications)

## Asset Placement

Place your custom images in the `img/` directory:

```
apps/avuz_theme/img/
├── network-diagram.png  ← Network/cloud diagram for left panel
├── logo.png             ← Logo 1 (top of login form)
└── logo2.png            ← Logo 2 (bottom of login form)
```

### Image Specifications

**network-diagram.png:**
- Recommended size: 1200x800px or similar aspect ratio
- Format: PNG or SVG
- Displayed at 60% size, centered in the left panel

**logo.png (Logo 1 - Top):**
- Recommended size: 160x50px
- Format: PNG
- Appears at the top of the white form card

**logo2.png (Logo 2 - Bottom):**
- Recommended size: 400x128px
- Format: PNG
- Appears at the bottom of the white form card

## Installation

1. **Place your assets:**
   ```bash
   cp /path/to/your/network-diagram.png apps/avuz_theme/img/
   cp /path/to/your/logo.png apps/avuz_theme/img/
   cp /path/to/your/logo2.png apps/avuz_theme/img/
   ```

2. **Enable the app:**
   ```bash
   # If using Docker
   docker exec nextcloud-app php occ app:enable avuz_theme

   # If running locally
   sudo -u www-data php occ app:enable avuz_theme
   ```

3. **Visit the login page:**
   ```
   http://your-domain.com/login
   ```

## Customization

All styling can be customized by editing `css/login.css`. The CSS file is well-commented and organized by sections:

- Split-screen layout and panels
- Logo positioning and sizing
- Form styling (inputs, buttons)
- Colors and backgrounds
- Responsive breakpoints

## Update Safety

✅ **This app is 100% update-safe.**

When you merge updates from upstream Nextcloud:

```bash
git fetch upstream
git merge upstream/master
```

Your `apps/avuz_theme/` directory will **never be touched** because it doesn't exist in the upstream repository. No merge conflicts!

## Troubleshooting

### App not appearing

Check if the app is installed and enabled:
```bash
docker exec nextcloud-app php occ app:list | grep avuz_theme
```

### CSS not loading

1. Clear browser cache (Ctrl+Shift+R or Cmd+Shift+R)
2. Reload the app:
   ```bash
   docker exec nextcloud-app php occ app:disable avuz_theme
   docker exec nextcloud-app php occ app:enable avuz_theme
   ```

### Images not showing

1. Verify image files exist:
   ```bash
   ls -la apps/avuz_theme/img/
   ```

2. Check file permissions:
   ```bash
   chmod 644 apps/avuz_theme/img/*
   ```

3. Verify file names match exactly:
   - `network-diagram.png`
   - `logo.png`
   - `logo2.png`

## File Structure

```
apps/avuz_theme/
├── README.md                                      ← This file
├── appinfo/
│   └── info.xml                                   ← App metadata
├── lib/
│   ├── AppInfo/
│   │   └── Application.php                        ← App bootstrap
│   └── Listener/
│       └── BeforeTemplateRenderedListener.php     ← Event listener
├── css/
│   └── login.css                                  ← Custom login styles
└── img/
    ├── network-diagram.png                        ← Left panel image
    ├── logo.png                                   ← Top logo
    └── logo2.png                                  ← Bottom logo
```

## How It Works

1. The app registers an event listener for `BeforeLoginTemplateRenderedEvent`
2. When the login page loads, the listener injects `css/login.css`
3. The CSS creates the split-screen layout using pseudo-elements and flexbox
4. No core files are modified - everything is done via CSS overrides

## License

AGPL-3.0-or-later (same as Nextcloud Server)
