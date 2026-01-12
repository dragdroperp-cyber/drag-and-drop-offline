
const [sellerSettings, setSellerSettings] = useState(null);

// Load custom seller settings
useEffect(() => {
    const loadCustomSettings = async () => {
        try {
            const settingsList = await getAllItems(STORES.settings);
            if (settingsList && settingsList.length > 0) {
                const s = settingsList[0];
                setSellerSettings(s);
                // Sync print format preference
                if (s.billSettings?.billFormat) {
                    setPrintSize(s.billSettings.billFormat);
                }
            }
        } catch (err) {
            console.error("Failed to load seller settings in Billing", err);
        }
    };
    loadCustomSettings();
}, []);
