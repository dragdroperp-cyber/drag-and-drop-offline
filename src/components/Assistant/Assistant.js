// Assistant.js
// Single-file: Inventory Assistant + In-component AI Chat (modal) + Voice (STT/TTS)
// Expects AppContext to expose: state.products, state.transactions, state.customers, state.currentLanguage
// Optional backend: POST /api/chat { message } -> { reply } and GET /api/ai/ping

import React, { useState, useEffect, useRef, useMemo } from "react";
import jsPDF from "jspdf";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { useApp } from "../../context/AppContext";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const BotIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </svg>
);

const UserIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const SendIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="m22 2-11 11" />
  </svg>
);

const LoaderIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

const BrainIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12 5a3 3 0 1 0-5.993 1.002A5 5 0 0 0 8 15a5 5 0 0 0 8 0 5 5 0 0 0 1.993-9.002A3 3 0 1 0 12 5Z" />
    <path d="M12 15v1" />
    <path d="M12 4V3" />
    <path d="M18.5 10.5 19.5 9.5" />
    <path d="M4.5 9.5 5.5 10.5" />
    <path d="M15 18H9" />
    <path d="M12 21v-3" />
  </svg>
);

const MicIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" x2="12" y1="19" y2="22" />
  </svg>
);

const ChevronDownIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const SYSTEM_INSTRUCTION = `
You are a conversational AI assistant named "Vox".
Your primary function is to detect the user's language in their LAST message and respond ONLY in that language.
You must support and differentiate between three languages: English, Hindi, and Hinglish.
You MUST adhere to the following tone and personality rules based on the detected language:

1.  **If the user speaks English:**
    * **Tone:** Formal, professional, and helpful.
    * **Context:** You are an assistant in a professional (e.g., ERP) environment.
    * **Example Response:** "Hello. How may I assist you today?"
    * **Response Prefix:** [lang:en-US]

2.  **If the user speaks Hindi (शुद्ध हिंदी):**
    * **Tone:** Very respectful, polite, and formal (अत्यंत आदरणीय, विनम्र, और औपचारिक).
    * **Rules:** Use pure, correct Hindi (शुद्ध हिंदी). Avoid English words completely. Address the user with 'आप'.
    * **Example Response:** "नमस्ते। मैं आपकी क्या सहायता कर सकता हूँ?"
    * **Response Prefix:** [lang:hi-IN]

3.  **If the user speaks Hinglish (e.g., "kya haal hai", "main theek hoon bro"):**
    * **Tone:** Very friendly, casual, and relaxed (एकदम दोस्ताना और आम बोलचाल).
    * **Rules:** Naturally mix Hindi and English words. Use common Hinglish phrases like 'bro', 'kya haal hai', 'sab badhiya', 'tension nahi'. It should sound like a friend talking.
    * **Example Response:** "Mai badhiya hu, aap kaise ho?" or "Sab theek hai bro, batao kya haal chal?"
    * **Response Prefix:** [lang:en-IN] (Use Indian English accent for Hinglish)

UI Control Rules:
-   Your primary role is conversation.
-   You have two ways to control the UI: setTheme and setCssVar.
-   1. setTheme (Full Theme):
    -   Use this for broad requests like "dark mode" or "light mode".
    -   The command format is: [CMD:{"action": "setTheme", "value": "themeName"}]
    -   Supported themeName values are: 'light', 'dark'.
    -   Example: [lang:en-US]Switching to dark mode. [CMD:{"action": "setTheme", "value": "dark"}]
-   2. setCssVar (Specific Color):
    -   Use this for specific requests like "make the header green" or "change my chat bubble to red."
    -   The command format is: [CMD:{"action": "setCssVar", "variable": "varName", "value": "rgb(r, g, b)"}]
    -   CRITICAL: Convert color names into professional rgb(r, g, b) values.
    -   Key Variables:
        -   --bg-secondary
        -   --bubble-user
        -   --bubble-bot
        -   --bg-chat
-   Multiple Commands are allowed in sequence.
`;

const themes = {
  light: {
    "--bg-primary": "249 250 251",
    "--bg-secondary": "255 255 255",
    "--bg-chat": "243 244 246",
    "--text-primary": "17 24 39",
    "--text-secondary": "107 114 128",
    "--border-primary": "229 231 235",
    "--bubble-bot": "255 255 255",
    "--bubble-user": "37 99 235",
    "--input-bg": "255 255 255",
  },
  dark: {
    "--bg-primary": "31 41 55",
    "--bg-secondary": "55 65 81",
    "--bg-chat": "17 24 39",
    "--text-primary": "243 244 246",
    "--text-secondary": "156 163 175",
    "--border-primary": "75 85 99",
    "--bubble-bot": "55 65 81",
    "--bubble-user": "37 99 235",
    "--input-bg": "55 65 81",
  },
};

const HARDCODED_GEMINI_KEY = "AIzaSyDiqf-vNMjF5SdGzC_15FwZ5IOyAjtuVVM";

const getGeminiApiKey = () =>
  process.env.REACT_APP_GEMINI_API_KEY ||
  window.__GEMINI_API_KEY__ ||
  HARDCODED_GEMINI_KEY;

const detectLanguageCode = (text = "") => {
  if (/[\u0900-\u097F]/.test(text)) return "hi-IN";
  if (/(bro|bhai|yaar|nahi|accha|acha|theek|kaise|kya|mast|tension)/i.test(text)) return "en-IN";
  return "en-US";
};

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
};

const parseRgbValue = (value = "") => {
  const trimmed = value.trim();
  const match = /^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/i.exec(trimmed);
  if (match) return `${match[1]} ${match[2]} ${match[3]}`;
  return trimmed;
};

const humanJoin = (items, conjunction = "and") => {
  if (!items || !items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  const head = items.slice(0, -1).join(", ");
  return `${head}, ${conjunction} ${items[items.length - 1]}`;
};

const languageText = (langCode, english, hindi, hinglish) => {
  if (langCode === "hi-IN") return hindi;
  if (langCode === "en-IN") return hinglish;
  return english;
};

const useExponentialBackoff = (model = "gemini-2.5-flash-preview-09-2025") => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchWithBackoff = async (payload, maxRetries = 5) => {
    setIsLoading(true);
    setError(null);

    let delay = 1000;
    const apiKey = getGeminiApiKey();

    if (!apiKey) {
      setIsLoading(false);
      return null;
    }

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        const candidate = result.candidates?.[0];
        const textResponse = candidate?.content?.parts?.[0]?.text;

        if (textResponse) {
          setIsLoading(false);
          return textResponse;
        }

        const safetyReason = candidate?.finishReason;
        if (safetyReason && safetyReason !== "STOP") {
          throw new Error(`Response blocked: ${safetyReason}`);
        }
        throw new Error("Invalid response structure from API.");
      } catch (err) {
        if (attempt === maxRetries - 1) {
          setError(err.message);
          setIsLoading(false);
    return null;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
    setIsLoading(false);
    return null;
  };

  return { fetchWithBackoff, isLoading, error, setError };
};

const computeReportData = (state = {}) => {
  const products = Array.isArray(state.products) ? state.products : [];
  const customers = Array.isArray(state.customers) ? state.customers : [];
  const transactions = Array.isArray(state.transactions) ? state.transactions : [];

    const totalProducts = products.length;
    const totalCustomers = customers.length;

  const stockValue = products.reduce((sum, product) => {
    const qty = Number(product.stock ?? product.quantity ?? 0);
    const price = Number(
      product.sellingPrice ?? product.price ?? product.costPrice ?? 0
    );
    return sum + qty * price;
  }, 0);

  const totalSales = transactions.reduce(
    (sum, tx) => sum + Number(tx.total ?? tx.amount ?? 0),
    0
  );

  const pendingCustomers = customers.filter(
    (customer) => Number(customer.balanceDue || 0) > 0
  );

  const totalDue = pendingCustomers.reduce(
    (sum, customer) => sum + Number(customer.balanceDue || 0),
    0
  );

  const lowStock = products
    .filter(
      (product) =>
        Number(product.stock ?? product.quantity ?? 0) <=
        (product.reorderLevel ?? 10)
    )
    .sort(
      (a, b) =>
        Number(a.stock ?? a.quantity ?? 0) -
        Number(b.stock ?? b.quantity ?? 0)
    )
    .slice(0, 5)
    .map((product) => ({
      name: product.name,
      quantity: Number(product.stock ?? product.quantity ?? 0),
      unit: product.quantityUnit || "units",
    }));

  const now = new Date();
  const datedProducts = products
    .filter((product) => product.expiryDate)
    .map((product) => {
      const expiry = new Date(product.expiryDate);
      if (Number.isNaN(expiry.getTime())) return null;
      return {
        name: product.name,
        expiry,
        formattedExpiry: expiry.toLocaleDateString(),
        quantity: Number(product.stock ?? product.quantity ?? 0),
      };
    })
    .filter(Boolean);

  const expiring = datedProducts
    .filter((item) => item.expiry >= now && item.expiry - now <= 1000 * 60 * 60 * 24 * 60)
    .sort((a, b) => a.expiry - b.expiry)
    .slice(0, 5);

  const expired = datedProducts
    .filter((item) => item.expiry < now)
    .sort((a, b) => b.expiry - a.expiry)
    .slice(0, 5);

  const productSales = new Map();
  transactions.forEach((tx) => {
    (tx.items || []).forEach((item) => {
      const key = item.name || item.productId || "Unknown";
      const previous = productSales.get(key) || 0;
      productSales.set(key, previous + Number(item.quantity || 0));
    });
  });

  const topSellers = Array.from(productSales.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, quantity]) => ({ name, quantity }));

  const salesByDate = new Map();
  transactions.forEach((tx) => {
    const rawDate = tx.date || tx.createdAt;
    if (!rawDate) return;
    const date = new Date(rawDate);
    if (Number.isNaN(date.getTime())) return;
    const isoKey = date.toISOString().split("T")[0];
    const label = date.toLocaleDateString();
    const total = Number(tx.total ?? tx.amount ?? 0);
    const current = salesByDate.get(isoKey) || { label, total: 0 };
    current.total += total;
    salesByDate.set(isoKey, current);
  });

  const salesSeries = Array.from(salesByDate.entries())
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .map(([, value]) => ({
      label: value.label,
      total: Number(value.total.toFixed(2)),
    }));

  const lossItems = products
    .map((product) => {
      const cost = Number(product.costPrice ?? product.purchasePrice ?? product.price ?? 0);
      const sell = Number(product.sellingPrice ?? product.price ?? 0);
      const stock = Number(product.stock ?? product.quantity ?? 0);
      if (!cost || sell >= cost) return null;
      const marginLoss = cost - sell;
      return {
        name: product.name,
        costPrice: cost,
        sellingPrice: sell,
        marginLoss,
        stock,
        potentialLoss: marginLoss * stock,
      };
    })
    .filter((item) => item && item.stock > 0)
    .sort((a, b) => b.potentialLoss - a.potentialLoss)
    .slice(0, 5);

  const totalPotentialLoss = lossItems.reduce((sum, item) => sum + item.potentialLoss, 0);

  return {
    totalProducts,
    totalCustomers,
    stockValue,
    totalSales,
    totalDue,
    pendingCustomerCount: pendingCustomers.length,
    lowStock,
    expiring,
    expired,
    topSellers,
    salesSeries,
    lossItems,
    totalPotentialLoss,
    hasData:
      totalProducts > 0 ||
      totalCustomers > 0 ||
      transactions.length > 0,
  };
};

const buildReportSummary = (report, langCode = "en-US") => {
  if (!report.hasData) {
    if (langCode === "hi-IN") {
      return "रिपोर्ट बनाने के लिए पर्याप्त डेटा उपलब्ध नहीं है। कृपया कुछ लेन-देन या उत्पाद जोड़ें।";
    }
    if (langCode === "en-IN") {
      return "Arre bro, abhi data thoda kam hai. Thoda inventory ya sales add kar lo, phir main detailed report bana dunga.";
    }
    return "There isn't enough data yet to build a useful report. Please add some inventory or sales first.";
  }

  const parts = [];

  if (langCode === "hi-IN") {
    parts.push(
      `वर्तमान रिकॉर्ड में ${report.totalProducts} उत्पाद और ${report.totalCustomers} ग्राहक शामिल हैं।`
    );
    parts.push(
      `कुल स्टॉक मूल्य लगभग ${formatCurrency(report.stockValue)} है तथा कुल बिक्री ${formatCurrency(
        report.totalSales
      )} दर्ज की गयी है।`
    );
    parts.push(
      report.pendingCustomerCount
        ? `बकाया ग्राहक: ${report.pendingCustomerCount}, कुल बकाया राशि ${formatCurrency(
            report.totalDue
          )} है।`
        : "किसी भी ग्राहक पर बकाया राशि शेष नहीं है।"
    );
    if (report.lowStock.length) {
      parts.push(
        `कम स्टॉक वाले उत्पाद: ${report.lowStock
          .map((item) => `${item.name} (${item.quantity} ${item.unit})`)
          .join(", ")}`
      );
    }
    if (report.expiring.length) {
      parts.push(
        `जल्द एक्सपायर होने वाले उत्पाद: ${report.expiring
          .map((item) => `${item.name} (${item.formattedExpiry})`)
          .join(", ")}`
      );
    }
    if (report.expired.length) {
      parts.push(
        `⚠️ एक्सपायर्ड उत्पाद: ${report.expired
          .map((item) => `${item.name} (${item.formattedExpiry})`)
          .join(", ")}`
      );
    }
    if (report.lossItems.length) {
      parts.push(
        `नुकसान वाली वस्तुएँ: ${report.lossItems
          .map(
            (item) =>
              `${item.name} (खरीद ₹${item.costPrice.toFixed(2)} | बिक्री ₹${item.sellingPrice.toFixed(
                2
              )})`
          )
          .join(", ")}`
      );
      parts.push(
        `संभावित नुकसान लगभग ${formatCurrency(report.totalPotentialLoss)} है।`
      );
    }
    if (report.topSellers.length) {
      parts.push(
        `सबसे अधिक बिकने वाले उत्पाद: ${report.topSellers
          .map((item) => `${item.name} (${item.quantity})`)
          .join(", ")}`
      );
    }
    return parts.join("\n");
  }

  if (langCode === "en-IN") {
    parts.push(
      `Right now we track ${report.totalProducts} products and ${report.totalCustomers} customers.`
    );
    parts.push(
      `Total stock value is around ${formatCurrency(report.stockValue)}, and combined sales stand at ${formatCurrency(
        report.totalSales
      )}.`
    );
    parts.push(
      report.pendingCustomerCount
        ? `Pending dues from ${report.pendingCustomerCount} customers amount to ${formatCurrency(
            report.totalDue
          )}.`
        : "No pending dues from any customer — sab clear hai."
    );
    if (report.lowStock.length) {
      parts.push(
        `Low stock alerts: ${report.lowStock
          .map((item) => `${item.name} (${item.quantity} ${item.unit})`)
          .join(", ")}`
      );
    }
    if (report.expiring.length) {
      parts.push(
        `Items expiring soon: ${report.expiring
          .map((item) => `${item.name} (${item.formattedExpiry})`)
          .join(", ")}`
      );
    }
    if (report.expired.length) {
      parts.push(
        `Heads-up: ${report.expired
          .map((item) => `${item.name} (${item.formattedExpiry})`)
          .join(", ")} already expired — inko shelf se hata do bro.`
      );
    }
    if (report.lossItems.length) {
      parts.push(
        `Loss alert: ${report.lossItems
          .map(
            (item) =>
              `${item.name} (buy ₹${item.costPrice.toFixed(2)} vs sell ₹${item.sellingPrice.toFixed(
                2
              )})`
          )
          .join(", ")}`
      );
      parts.push(
        `Total potential loss sits near ${formatCurrency(report.totalPotentialLoss)} — margin sudharo.`
      );
    }
    if (report.topSellers.length) {
      parts.push(
        `Top sellers: ${report.topSellers
          .map((item) => `${item.name} (${item.quantity})`)
          .join(", ")}`
      );
    }
    return parts.join("\n");
  }

  parts.push(
    `We currently track ${report.totalProducts} products and ${report.totalCustomers} customers.`
  );
  parts.push(
    `Total stock value is ${formatCurrency(report.stockValue)}, while cumulative sales equal ${formatCurrency(
      report.totalSales
    )}.`
  );
  parts.push(
    report.pendingCustomerCount
      ? `There are ${report.pendingCustomerCount} customers with outstanding dues worth ${formatCurrency(
          report.totalDue
        )}.`
      : "All customer dues are clear at the moment."
  );
  if (report.lowStock.length) {
    parts.push(
      `Low stock items: ${report.lowStock
        .map((item) => `${item.name} (${item.quantity} ${item.unit})`)
        .join(", ")}`
    );
  }
  if (report.expiring.length) {
    parts.push(
      `Expiring soon: ${report.expiring
        .map((item) => `${item.name} (${item.formattedExpiry})`)
        .join(", ")}`
    );
  }
    if (report.expired.length) {
      parts.push(
        `Expired inventory detected: ${report.expired
          .map((item) => `${item.name} (${item.formattedExpiry})`)
          .join(", ")} — please remove or mark for write-off.`
      );
    }
    if (report.lossItems.length) {
      parts.push(
        `Negative margin items: ${report.lossItems
          .map(
            (item) =>
              `${item.name} (cost ₹${item.costPrice.toFixed(2)} vs sell ₹${item.sellingPrice.toFixed(
                2
              )})`
          )
          .join(", ")}`
      );
      parts.push(
        `Estimated potential loss: ${formatCurrency(report.totalPotentialLoss)}.`
      );
    }
  if (report.topSellers.length) {
    parts.push(
      `Top sellers: ${report.topSellers
        .map((item) => `${item.name} (${item.quantity})`)
        .join(", ")}`
    );
  }
  return parts.join("\n");
};

const buildGraphConfig = (report) => {
  if (!report.salesSeries || !report.salesSeries.length) return null;
  const lastSeven = report.salesSeries.slice(-7);
  return {
    data: {
      labels: lastSeven.map((item) => item.label),
      datasets: [
        {
          label: "Daily Sales (INR)",
          data: lastSeven.map((item) => item.total),
          backgroundColor: "rgba(37, 99, 235, 0.75)",
          borderRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: "Last 7 Days Sales" },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#4B5563" },
        },
        y: {
          grid: { color: "rgba(148, 163, 184, 0.3)" },
          ticks: {
            color: "#4B5563",
            callback: (value) => `₹${value}`,
          },
        },
      },
    },
  };
};

const createPdfReport = (report, storeName = "Inventory Overview") => {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const headerHeight = 82;

  // Header banner
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 0, pageWidth, headerHeight, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(storeName, 40, 42);
  doc.setFontSize(12);
  doc.text("Inventory Intelligence Report", 40, 62);

  // Footer
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.5);
  doc.line(40, 780, pageWidth - 40, 780);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 124, 133);
  doc.text(
    `Generated on ${new Date().toLocaleString()}`,
    40,
    796
  );
  doc.text(`Page 1 of 1`, pageWidth - 90, 796);

  // Body styling
  doc.setTextColor(33, 37, 41);
  doc.setFontSize(11);
  let y = headerHeight + 30;

  const addSectionHeader = (title) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(37, 99, 235);
    doc.text(title, 40, y);
    y += 10;
    doc.setDrawColor(222, 226, 230);
    doc.setLineWidth(0.7);
    doc.line(40, y, pageWidth - 40, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(33, 37, 41);
  };

  const addKeyValueRow = (label, value) => {
    doc.setFont("helvetica", "bold");
    doc.text(label, 40, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(value), 200, y);
    y += 18;
  };

  addSectionHeader("Executive Summary");
  addKeyValueRow("Total Products", report.totalProducts);
  addKeyValueRow("Total Customers", report.totalCustomers);
  addKeyValueRow("Stock Value", formatCurrency(report.stockValue));
  addKeyValueRow("Cumulative Sales", formatCurrency(report.totalSales));
  addKeyValueRow(
    "Pending Customer Dues",
    `${formatCurrency(report.totalDue)} (${report.pendingCustomerCount} customers)`
  );

  const addBulletList = (title, rows, formatter) => {
    if (!rows || !rows.length) return;
    y += 6;
    addSectionHeader(title);
    rows.forEach((row) => {
      const line = formatter(row);
      const split = doc.splitTextToSize(line, pageWidth - 100);
      doc.circle(45, y - 3, 2, "F");
      doc.text(split, 60, y);
      y += split.length * 14;
      if (y > 720) {
        doc.addPage();
        y = 60;
      }
    });
  };

  addBulletList("Low Stock Alerts", report.lowStock, (item) =>
    `${item.name} — ${item.quantity} ${item.unit}`
  );

  addBulletList("Expiring Within 60 Days", report.expiring, (item) =>
    `${item.name} — ${item.formattedExpiry} (${item.quantity} units)`
  );

  addBulletList("Expired Inventory", report.expired, (item) =>
    `${item.name} — expired on ${item.formattedExpiry}`
  );

  addBulletList("Top Selling Products", report.topSellers, (item) =>
    `${item.name} — ${item.quantity} units sold`
  );

  addBulletList("Negative Margin Products", report.lossItems, (item) =>
    `${item.name} — buy ₹${item.costPrice.toFixed(2)} | sell ₹${item.sellingPrice.toFixed(
      2
    )} | stock ${item.stock} (${formatCurrency(item.potentialLoss)} at risk)`
  );

  addBulletList("Sales Trend (Last 7 data points)", report.salesSeries.slice(-7), (item) =>
    `${item.label}: ${formatCurrency(item.total)}`
  );

  const filename = `inventory-report-${new Date()
    .toISOString()
    .split("T")[0]}.pdf`;
  doc.save(filename);
  return filename;
};

const buildLowStockAlert = (report, langCode) => {
  if (!report.lowStock.length) return null;
  const list = report.lowStock
    .map((item) => `${item.name} (${item.quantity} ${item.unit})`)
    .slice(0, 5);
  return languageText(
    langCode,
    `⚠️ Low stock alert: ${humanJoin(list)}`,
    `⚠️ कम स्टॉक अलर्ट: ${humanJoin(list, "और")}`,
    `⚠️ Low stock alert bro: ${humanJoin(list)}`
  );
};

const buildExpiryAlert = (report, langCode) => {
  const lines = [];
  if (report.expired.length) {
    const expiredList = report.expired
      .map((item) => `${item.name} (${item.formattedExpiry})`)
      .slice(0, 5);
    lines.push(
      languageText(
        langCode,
        `⚠️ Expired items: ${humanJoin(expiredList)}`,
        `⚠️ एक्सपायर्ड आइटम: ${humanJoin(expiredList, "और")}`,
        `⚠️ Ye items expire ho chuke hain: ${humanJoin(expiredList)}`
      )
    );
  }
  if (report.expiring.length) {
    const expiringList = report.expiring
      .map((item) => `${item.name} (${item.formattedExpiry})`)
      .slice(0, 5);
    lines.push(
      languageText(
        langCode,
        `⏳ Expiring soon: ${humanJoin(expiringList)}`,
        `⏳ जल्द एक्सपायर होने वाले: ${humanJoin(expiringList, "और")}`,
        `⏳ Jaldi expire hone wale items: ${humanJoin(expiringList)}`
      )
    );
  }
  return lines.length ? lines.join("\n") : null;
};

const buildLossAlert = (report, langCode) => {
  if (!report.lossItems.length) return null;
  const list = report.lossItems
    .map(
      (item) =>
        `${item.name} (buy ₹${item.costPrice.toFixed(2)} | sell ₹${item.sellingPrice.toFixed(2)})`
    )
    .slice(0, 5);

  const summary = languageText(
    langCode,
    `🚨 Negative margin items: ${humanJoin(list)} — potential loss ${formatCurrency(
      report.totalPotentialLoss
    )}.`,
    `🚨 नुकसान वाले उत्पाद: ${humanJoin(list, "और")} — संभावित नुकसान ${formatCurrency(
      report.totalPotentialLoss
    )}।`,
    `🚨 In items pe loss ho gaya hai: ${humanJoin(list)} (potential loss ${formatCurrency(
      report.totalPotentialLoss
    )}).`
  );

  return summary;
};

const buildInventorySnapshot = (report, langCode) => {
  if (!report.hasData) {
    return languageText(
      langCode,
      "I need a little more data before I can summarise your inventory.",
      "इन्वेंट्री का सारांश देने के लिए मुझे पहले कुछ डेटा चाहिए।",
      "Thoda data update karo bro, fir main full inventory snapshot doon?"
    );
  }

  const header = languageText(
    langCode,
    `📦 Snapshot: ${report.totalProducts} products • ${report.totalCustomers} customers • Stock value ${formatCurrency(
      report.stockValue
    )}`,
    `📦 सारांश: ${report.totalProducts} उत्पाद • ${report.totalCustomers} ग्राहक • स्टॉक मूल्य ${formatCurrency(
      report.stockValue
    )}`,
    `📦 Snapshot: ${report.totalProducts} products • ${report.totalCustomers} customers • Stock value ${formatCurrency(
      report.stockValue
    )}`
  );

  const dues = languageText(
    langCode,
    report.pendingCustomerCount
      ? `💸 Pending dues: ${formatCurrency(report.totalDue)} from ${report.pendingCustomerCount} customers.`
      : "💸 No pending dues — all accounts are clear.",
    report.pendingCustomerCount
      ? `💸 बकाया राशि: ${formatCurrency(report.totalDue)} (${report.pendingCustomerCount} ग्राहक)।`
      : "💸 कोई बकाया नहीं — सभी खाते क्लियर हैं।",
    report.pendingCustomerCount
      ? `💸 Pending dues ${formatCurrency(report.totalDue)} (${report.pendingCustomerCount} customers).`
      : "💸 Sab dues clear hain — great!"
  );

  const collect = [header, dues];

  const lowStockAlert = buildLowStockAlert(report, langCode);
  if (lowStockAlert) collect.push(lowStockAlert);

  const expiryAlert = buildExpiryAlert(report, langCode);
  if (expiryAlert) collect.push(expiryAlert);

  const lossAlert = buildLossAlert(report, langCode);
  if (lossAlert) collect.push(lossAlert);

  if (report.topSellers.length) {
    const list = report.topSellers.map((item) => `${item.name} (${item.quantity})`).slice(0, 5);
    collect.push(
      languageText(
        langCode,
        `🔥 Top sellers: ${humanJoin(list)}.`,
        `🔥 सबसे ज़्यादा बिकने वाले: ${humanJoin(list, "और")}।`,
        `🔥 Top sellers: ${humanJoin(list)}.`
      )
    );
  }

  return collect.join("\n");
};

const normaliseText = (value = "") => value.toString().trim().toLowerCase();

const findCustomerMatches = (customers = [], name = "") => {
  const query = normaliseText(name);
  if (!query) return [];
  return customers.filter((customer) =>
    normaliseText(customer.name || customer.email || "").includes(query)
  );
};

const findTransactionsForCustomer = (transactions = [], name = "") => {
  const query = normaliseText(name);
  if (!query) return [];
  return transactions.filter((tx) => {
    const customerName = tx.customer || tx.customerName || tx.name || "";
    return normaliseText(customerName).includes(query);
  });
};

const findProductByName = (products = [], name = "") => {
  const query = normaliseText(name);
  if (!query) return null;

  const exact = products.find(
    (product) =>
      normaliseText(product.name) === query ||
      normaliseText(product.sku || product.barcode || "") === query
  );
  if (exact) return exact;

  const partial = products.find((product) => normaliseText(product.name).includes(query));
  if (partial) return partial;

  const tokens = query.split(/\s+/).filter(Boolean);
  return (
    products.find((product) => {
      const nameTokens = normaliseText(product.name).split(/\s+/);
      return tokens.every((token) => nameTokens.includes(token));
    }) || null
  );
};

const findCustomerByName = (customers = [], name = "") => {
  const query = normaliseText(name);
  if (!query) return null;
  return (
    customers.find((customer) => normaliseText(customer.name).includes(query)) ||
    customers.find((customer) => normaliseText(customer.email || "").includes(query)) ||
    null
  );
};

const buildInvoiceSummary = (customerName, invoice, langCode) => {
  if (!invoice) {
    return languageText(
      langCode,
      `I couldn't find any invoices for ${customerName}.`,
      `${customerName} के लिए कोई बिल नहीं मिला।`,
      `${customerName} ke liye koi invoice nahi mila bro.`
    );
  }

  const items = (invoice.items || []).map((item) => {
    const qty = Number(item.quantity ?? item.qty ?? 0);
    const rate = Number(item.price ?? item.rate ?? item.sellingPrice ?? 0);
    const total = Number(item.total ?? qty * rate);
    return `• ${item.name || item.productId || "Item"} — ${qty} × ${formatCurrency(rate)} = ${formatCurrency(
      total
    )}`;
  });

  const total = formatCurrency(invoice.total ?? invoice.amount ?? 0);
  const date = invoice.date
    ? new Date(invoice.date).toLocaleString()
    : invoice.createdAt
    ? new Date(invoice.createdAt).toLocaleString()
    : "N/A";

  const header = languageText(
    langCode,
    `🧾 Invoice for ${customerName} — Total ${total} (${date})`,
    `🧾 ${customerName} का बिल — कुल ${total} (${date})`,
    `🧾 Invoice ready for ${customerName}: total ${total} (${date})`
  );

  return [header, ...items].join("\n");
};

const createInvoicePdf = (invoice, customerName, storeName = "Retail Store") => {
  if (!invoice) return null;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, pageWidth, 90, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(storeName, 40, 48);
  doc.setFontSize(12);
  doc.text("Customer Invoice", 40, 70);

  doc.setTextColor(33, 37, 41);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  const customerLine = `Customer: ${customerName}`;
  const invoiceDate = invoice.date
    ? new Date(invoice.date).toLocaleString()
    : invoice.createdAt
    ? new Date(invoice.createdAt).toLocaleString()
    : new Date().toLocaleString();
  const invoiceNumber = invoice.billId || invoice.reference || `INV-${Date.now()}`;

  let y = 120;
  doc.text(customerLine, 40, y);
  doc.text(`Invoice #: ${invoiceNumber}`, pageWidth / 2, y);
  y += 18;
  doc.text(`Date: ${invoiceDate}`, 40, y);
  doc.text(`Payment Mode: ${invoice.paymentMode || invoice.mode || "N/A"}`, pageWidth / 2, y);
  y += 24;

  doc.setFont("helvetica", "bold");
  doc.setFillColor(37, 99, 235);
  doc.setTextColor(255, 255, 255);
  doc.roundedRect(40, y, pageWidth - 80, 28, 6, 6, "F");
  doc.text("Items", 52, y + 18);
  doc.text("Qty", pageWidth / 2 - 40, y + 18);
  doc.text("Rate", pageWidth / 2 + 20, y + 18);
  doc.text("Amount", pageWidth - 120, y + 18);

  y += 40;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(33, 37, 41);

  (invoice.items || []).forEach((item) => {
    if (y > 700) {
      doc.addPage();
      y = 80;
    }
    const qty = Number(item.quantity ?? item.qty ?? 0);
    const rate = Number(item.price ?? item.rate ?? item.sellingPrice ?? 0);
    const total = Number(item.total ?? qty * rate);

    doc.text(item.name || item.productId || "Item", 52, y);
    doc.text(String(qty), pageWidth / 2 - 40, y, { align: "right" });
    doc.text(formatCurrency(rate), pageWidth / 2 + 60, y, { align: "right" });
    doc.text(formatCurrency(total), pageWidth - 60, y, { align: "right" });
    y += 22;
  });

  y += 10;
  doc.setLineWidth(0.5);
  doc.setDrawColor(229, 231, 235);
  doc.line(pageWidth / 2, y, pageWidth - 40, y);
  y += 18;

  const subtotal = formatCurrency(invoice.subtotal ?? invoice.total ?? 0);
  const tax = formatCurrency(invoice.tax ?? invoice.gst ?? 0);
  const discount = formatCurrency(invoice.discount ?? 0);
  const total = formatCurrency(invoice.total ?? invoice.amount ?? 0);

  const totals = [
    { label: "Subtotal", value: subtotal },
    { label: "Tax", value: tax },
    { label: "Discount", value: discount },
    { label: "Grand Total", value: total },
  ];

  totals.forEach(({ label, value }) => {
    doc.text(label, pageWidth / 2 + 60, y);
    doc.text(value, pageWidth - 60, y, { align: "right" });
    y += 18;
  });

  y += 20;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(10);
  doc.text("Thank you for your business!", 40, y);

  const filename = `invoice-${customerName}-${Date.now()}.pdf`;
  doc.save(filename);
  return filename;
};

const Assistant = () => {
  const { state } = useApp();

  const [chatHistory, setChatHistory] = useState([
    {
      role: "model",
      parts: [{ text: "Hello! I'm Vox. How may I assist you?" }],
    },
  ]);
  const chatHistoryRef = useRef(chatHistory);

  const [userInput, setUserInput] = useState("");
  const { fetchWithBackoff, isLoading, error, setError } = useExponentialBackoff();
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentTheme, setCurrentTheme] = useState("light");
  const [graphConfig, setGraphConfig] = useState(null);
  const [lastReportText, setLastReportText] = useState(null);
  const [reportTimestamp, setReportTimestamp] = useState(null);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);

  const chatContainerRef = useRef(null);
  const recognitionRef = useRef(null);
  const appRef = useRef(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

  const reportData = useMemo(
    () => computeReportData(state),
    [state.products, state.customers, state.transactions]
  );

  useEffect(() => {
    const theme = themes[currentTheme];
    if (!theme || !appRef.current) return;
    Object.entries(theme).forEach(([token, value]) => {
      appRef.current.style.setProperty(token, value);
    });
  }, [currentTheme]);

  const scrollChatToBottom = (smooth = true) => {
    const container = chatContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  };

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const threshold = 160;
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const nearBottom = distanceFromBottom <= threshold;
      autoScrollRef.current = nearBottom;
      setShowScrollToLatest(!nearBottom);
    };

    container.addEventListener("scroll", handleScroll);
    handleScroll();

    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (autoScrollRef.current) {
      scrollChatToBottom(chatHistory.length > 1);
    }
  }, [chatHistory, isLoading]);

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang =
      state.voiceAssistantLanguage ||
      (state.currentLanguage === "hi" ? "hi-IN" : "hi-IN");
    recognition.maxAlternatives = 2;

    recognition.onstart = () => {
      setIsListening(true);
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognition.onerror = (event) => {
      setIsListening(false);
      setError(`Speech recognition error: ${event.error}`);
    };
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result[0]?.transcript) {
          transcript += result[0].transcript;
        }
      }
      const cleaned = transcript.trim();
      if (!cleaned) return;
      setUserInput(cleaned);
      const lastResult = event.results[event.results.length - 1];
      if (lastResult?.isFinal) {
        recognition.stop();
        handleSendMessage(null, cleaned);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.voiceAssistantLanguage, state.currentLanguage]);

  useEffect(() => {
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const speak = (text, langCode = "en-US") => {
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = langCode;
      utterance.rate = 0.95;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error("Speech synthesis error", err);
      setIsSpeaking(false);
    }
  };

  const appendAssistantMessage = (text, langCode = "en-US", options = {}) => {
    const newMessage = { role: "model", parts: [{ text }] };
    const updatedHistory = [...chatHistoryRef.current, newMessage];
    chatHistoryRef.current = updatedHistory;
    setChatHistory(updatedHistory);
    if (!options.skipSpeech) {
      speak(text, langCode);
    }
  };

  const toggleListen = () => {
    if (!recognitionRef.current) {
      setError("Microphone access is unavailable.");
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      window.speechSynthesis?.cancel();
      setIsSpeaking(false);
      recognitionRef.current.lang =
        state.voiceAssistantLanguage ||
        (state.currentLanguage === "hi" ? "hi-IN" : "hi-IN");
      setUserInput("");
      recognitionRef.current.start();
    }
  };

  const handleClearChat = () => {
    const startingMessage = {
      role: "model",
      parts: [{ text: "Hello! I'm Vox. How may I assist you?" }],
    };
    chatHistoryRef.current = [startingMessage];
    setChatHistory([startingMessage]);
    setGraphConfig(null);
    setLastReportText(null);
    setReportTimestamp(null);
    autoScrollRef.current = true;
    scrollChatToBottom(false);
  };

  const handleThemeQuickAction = (themeKey) => {
    setCurrentTheme(themeKey);
    const theme = themes[themeKey];
    if (theme && appRef.current) {
      Object.entries(theme).forEach(([token, value]) =>
        appRef.current.style.setProperty(token, value)
      );
    }
  };

  const generateLocalResponse = (message, langCode) => {
    const normalizedMessage = normaliseText(message);
    if (!normalizedMessage) return null;

    const mentionInventory =
      normalizedMessage.includes("inventory") ||
      normalizedMessage.includes("stock status") ||
      normalizedMessage.includes("stock report") ||
      normalizedMessage.includes("overall") ||
      normalizedMessage.includes("summary") ||
      normalizedMessage.includes("snapshot");

    if (mentionInventory) {
      return buildInventorySnapshot(reportData, langCode);
    }

    const lowStockText = buildLowStockAlert(reportData, langCode);
    if (
      normalizedMessage.includes("low stock") ||
      normalizedMessage.includes("kam stock") ||
      normalizedMessage.includes("stock kam") ||
      normalizedMessage.includes("reorder")
    ) {
      return (
        lowStockText ||
        languageText(
          langCode,
          "No products are currently below their reorder level.",
          "अभी किसी भी उत्पाद का स्टॉक कम नहीं है।",
          "Sab products ka stock theek hai bro."
        )
      );
    }

    if (
      normalizedMessage.includes("expiry") ||
      normalizedMessage.includes("expire") ||
      normalizedMessage.includes("expiring") ||
      normalizedMessage.includes("expire ho")
    ) {
      return (
        buildExpiryAlert(reportData, langCode) ||
        languageText(
          langCode,
          "No upcoming expiries detected.",
          "कोई उत्पाद जल्द एक्सपायर नहीं हो रहा है।",
          "Abhi koi item expire nahi ho raha."
        )
      );
    }

    if (
      normalizedMessage.includes("loss") ||
      normalizedMessage.includes("nuksan") ||
      normalizedMessage.includes("loss ho")
    ) {
      return (
        buildLossAlert(reportData, langCode) ||
        languageText(
          langCode,
          "All items are currently profitable.",
          "सभी उत्पाद अभी लाभ में हैं।",
          "Sab items profit me chal rahe hain bro."
        )
      );
    }

    if (
      normalizedMessage.includes("top selling") ||
      normalizedMessage.includes("best selling") ||
      normalizedMessage.includes("sabse zyada") ||
      normalizedMessage.includes("zyada bik")
    ) {
      if (reportData.topSellers.length) {
        const list = reportData.topSellers
          .map((item) => `${item.name} (${item.quantity})`)
          .slice(0, 5);
        return languageText(
          langCode,
          `🔥 Top sellers: ${humanJoin(list)}.`,
          `🔥 सबसे ज़्यादा बिकने वाले: ${humanJoin(list, "और")}।`,
          `🔥 Top sellers: ${humanJoin(list)}.`
        );
      }
      return languageText(
        langCode,
        "Sales data isn't available yet.",
        "बिक्री का डेटा अभी उपलब्ध नहीं है।",
        "Abhi sales data nahi mila bro."
      );
    }

    if (
      normalizedMessage.includes("due") ||
      normalizedMessage.includes("balance") ||
      normalizedMessage.includes("pending") ||
      normalizedMessage.includes("paise") ||
      normalizedMessage.includes("owe")
    ) {
      if (!state.customers?.length) {
        return languageText(
          langCode,
          "No customer records available yet.",
          "अभी ग्राहक रिकॉर्ड उपलब्ध नहीं है।",
          "Abhi customer data nahi mila."
        );
      }

      const pending = (state.customers || []).filter(
        (customer) => Number(customer.balanceDue || 0) > 0
      );

      if (!pending.length) {
        return languageText(
          langCode,
          "All customer dues are cleared.",
          "सभी ग्राहकों के बकाया साफ़ हैं।",
          "Sab ke dues clear ho chuke hain."
        );
      }

      const list = pending
        .map(
          (customer) =>
            `${customer.name} (${formatCurrency(customer.balanceDue || 0)})`
        )
        .slice(0, 5);

      return languageText(
        langCode,
        `⏳ Pending dues: ${humanJoin(list)}.`,
        `⏳ बकाया सूची: ${humanJoin(list, "और")}।`,
        `⏳ Pending dues: ${humanJoin(list)}.`
      );
    }

    const matchedProduct = findProductByName(state.products, message);
    if (matchedProduct) {
      const qty = Number(matchedProduct.stock ?? matchedProduct.quantity ?? 0);
      const unit = matchedProduct.quantityUnit || "units";
      const selling = formatCurrency(matchedProduct.sellingPrice ?? matchedProduct.price ?? 0);
      const cost = formatCurrency(matchedProduct.costPrice ?? matchedProduct.purchasePrice ?? 0);
      const expiry = matchedProduct.expiryDate
        ? new Date(matchedProduct.expiryDate).toLocaleDateString()
        : languageText(langCode, "N/A", "उपलब्ध नहीं", "N/A");
      const lowStock = qty <= (matchedProduct.reorderLevel ?? 10);

      const line = languageText(
        langCode,
        `📦 ${matchedProduct.name}: stock ${qty} ${unit}, selling price ${selling}, cost ${cost}, expiry ${expiry}.`,
        `📦 ${matchedProduct.name}: स्टॉक ${qty} ${unit}, बिक्री मूल्य ${selling}, खरीद मूल्य ${cost}, एक्सपायरी ${expiry}।`,
        `📦 ${matchedProduct.name}: stock ${qty} ${unit}, selling ${selling}, cost ${cost}, expiry ${expiry}.`
      );

      const lowStockNote =
        lowStock &&
        languageText(
          langCode,
          "⚠️ This item is running low. Consider restocking soon.",
          "⚠️ यह आइटम कम हो रहा है, जल्द स्टॉक भरें।",
          "⚠️ Ye item low stock me hai, jaldi restock karo."
        );

      return lowStockNote ? `${line}\n${lowStockNote}` : line;
    }

    if (
      normalizedMessage.includes("graph") ||
      normalizedMessage.includes("chart")
    ) {
      return languageText(
        langCode,
        "Tap the 'Show Sales Graph' quick action or say 'show the sales graph' and I'll display it.",
        "“Show Sales Graph” बटन दबाएँ या बोलें, मैं ग्राफ़ दिखा दूँगा।",
        "Quick action 'Show Sales Graph' dabao bro, main graph dikha dunga."
      );
    }

    if (
      normalizedMessage.includes("report") ||
      normalizedMessage.includes("summary")
    ) {
      return buildReportSummary(reportData, langCode);
    }

    return null;
  };

  const handleLocalAssistantCommand = async (input, langCode) => {
    const normalized = input.toLowerCase();

    if (normalized.includes("download") && normalized.includes("pdf")) {
      if (!reportData.hasData) {
        appendAssistantMessage(
          langCode === "hi-IN"
            ? "रिपोर्ट डाउनलोड करने के लिए पहले कुछ लेन-देन या स्टॉक जानकारी जोड़ें।"
            : langCode === "en-IN"
            ? "Bro, mujhe pehle thoda data chahiye tabhi PDF bana paunga."
            : "Please record some inventory or sales first so I can build the PDF report.",
          langCode
        );
        return true;
      }
      const filename = createPdfReport(
        reportData,
        state.storeName || state.currentUser?.storeName || "Inventory Overview"
      );
      appendAssistantMessage(
        langCode === "hi-IN"
          ? `रिपोर्ट डाउनलोड कर दी गई है (${filename}).`
          : langCode === "en-IN"
          ? `Report ready bro! File download ho gayi (${filename}).`
          : `All done. I saved the PDF as ${filename}.`,
        langCode
      );
      return true;
    }

    if (normalized.includes("show") && normalized.includes("graph")) {
      const graph = buildGraphConfig(reportData);
      if (graph) {
        setGraphConfig(graph);
        appendAssistantMessage(
          langCode === "hi-IN"
            ? "यह रहा पिछले सात दिनों का बिक्री ग्राफ़।"
            : langCode === "en-IN"
            ? "Ye lo bro, last 7 days ka sales chart ready hai."
            : "Here is the sales graph for the last seven days.",
          langCode
        );
      } else {
        appendAssistantMessage(
          langCode === "hi-IN"
            ? "ग्राफ़ दिखाने के लिए अभी पर्याप्त बिक्री डेटा नहीं मिला।"
            : langCode === "en-IN"
            ? "Graph ke liye data kam hai yaar. Thoda aur sales record karo."
            : "I need a bit more sales data before I can draw a graph.",
          langCode
        );
      }
      return true;
    }

    if (
      normalized.includes("overall report") ||
      normalized.includes("generate report") ||
      normalized.includes("full report") ||
      normalized.includes("summary report")
    ) {
      const summary = buildReportSummary(reportData, langCode);
      appendAssistantMessage(summary, langCode);
      setLastReportText(summary);
      setReportTimestamp(new Date());
      return true;
    }

    if (
      normalized.includes("invoice") ||
      normalized.includes("bill") ||
      normalized.includes("challan")
    ) {
      if (!state.transactions?.length) {
        appendAssistantMessage(
          languageText(
            langCode,
            "I couldn't find any invoices in the system yet.",
            "अभी सिस्टम में कोई बिल उपलब्ध नहीं है।",
            "Abhi system me koi invoice nahi mila bro."
          ),
          langCode
        );
        return true;
      }

      const customers = state.customers || [];
      let customerName = "";
      const explicitName = input.match(
        /(?:invoice|bill|challan|generate|ban(?:ao|a))\s*(?:number\s*)?(?:for|of|to)\s+([A-Za-z\u0900-\u097F\s]+)/i
      );

      if (explicitName) {
        customerName = explicitName[1].trim();
      }

      if (!customerName && customers.length) {
        const detected = customers.find((customer) =>
          normalized.includes(normaliseText(customer.name))
        );
        if (detected) {
          customerName = detected.name;
        }
      }

      if (!customerName) {
        appendAssistantMessage(
          languageText(
            langCode,
            "Please tell me which customer the invoice should be generated for.",
            "कृपया बताएँ invoice किस ग्राहक के लिए बनाना है।",
            "Invoice kiske naam se banana hai bro?"
          ),
          langCode
        );
        return true;
      }

      const invoiceMatches = findTransactionsForCustomer(state.transactions, customerName);
      const latestInvoice = invoiceMatches.length ? invoiceMatches[invoiceMatches.length - 1] : null;

      const summary = buildInvoiceSummary(customerName, latestInvoice, langCode);
      appendAssistantMessage(summary, langCode);

      if (!latestInvoice) {
        return true;
      }

      if (normalized.includes("download") || normalized.includes("pdf")) {
        const filename = createInvoicePdf(
          latestInvoice,
          customerName,
          state.storeName || state.currentUser?.storeName || "Retail Store"
        );
        if (filename) {
          appendAssistantMessage(
            languageText(
              langCode,
              `Invoice saved as ${filename}.`,
              `Invoice ${filename} नाम से सेव हो गया है।`,
              `Invoice ${filename} naam se download ho gaya hai bro.`
            ),
            langCode
          );
        }
      }

      return true;
    }

    if (normalized.includes("clear graph")) {
      setGraphConfig(null);
      appendAssistantMessage(
        langCode === "hi-IN"
          ? "ग्राफ़ हटा दिया गया है।"
          : langCode === "en-IN"
          ? "Graph hata diya bro."
          : "Removed the graph from the view.",
        langCode
      );
      return true;
    }

    return false;
  };

  const processCommandsFromModel = (cmdMatches, langCode) => {
    if (!cmdMatches) return;
    cmdMatches.forEach((match) => {
      try {
        const jsonString = match.slice(5, -1);
        const cmd = JSON.parse(jsonString);
        if (cmd.action === "setTheme" && (cmd.value === "light" || cmd.value === "dark")) {
          setCurrentTheme(cmd.value);
        }
        if (cmd.action === "setCssVar" && cmd.variable && cmd.value) {
          if (appRef.current) {
            appRef.current.style.setProperty(cmd.variable, parseRgbValue(cmd.value));
          }
        }
        if (cmd.action === "downloadReport") {
          if (reportData.hasData) {
            const filename = createPdfReport(
              reportData,
              state.storeName || state.currentUser?.storeName || "Inventory Overview"
            );
            appendAssistantMessage(
              `Downloaded the report as ${filename}.`,
              langCode,
              { skipSpeech: true }
            );
          }
        }
        if (cmd.action === "showSalesGraph") {
          const graph = buildGraphConfig(reportData);
          if (graph) {
            setGraphConfig(graph);
          }
        }
        if (cmd.action === "generateReport") {
          const summary = buildReportSummary(reportData, langCode);
          appendAssistantMessage(summary, langCode, { skipSpeech: true });
          setLastReportText(summary);
          setReportTimestamp(new Date());
        }
      } catch (parseError) {
        console.error("Failed to parse AI command:", parseError);
      }
    });
  };

  const processAiResponse = (responseText) => {
    let langCode = "en-US";
    let processedText = responseText;

    const langMatch = processedText.match(/^\[lang:([\w-]+)\]/);
    if (langMatch) {
      langCode = langMatch[1];
      processedText = processedText.replace(/^\[lang:[\w-]+\]/, "").trim();
    }

    let cleanText = processedText;
    const cmdMatches = processedText.match(/\[CMD:({.*?})\]/g);
    if (cmdMatches) {
      cleanText = processedText.replace(/\[CMD:({.*?})\]/g, "").trim();
      processCommandsFromModel(cmdMatches, langCode);
    }

    if (cleanText) {
      appendAssistantMessage(cleanText, langCode);
    }
  };

  const handleSendMessage = async (event, textOverride = "") => {
    if (event) event.preventDefault();
    const trimmedInput = textOverride || userInput.trim();
    if (!trimmedInput) return;

    const userMessage = { role: "user", parts: [{ text: trimmedInput }] };
    const updatedHistory = [...chatHistoryRef.current, userMessage];
    chatHistoryRef.current = updatedHistory;
    setChatHistory(updatedHistory);
    setUserInput("");
    setError(null);

    const langCode = detectLanguageCode(trimmedInput);

    if (await handleLocalAssistantCommand(trimmedInput, langCode)) {
      return;
    }

    const localAnswer = generateLocalResponse(trimmedInput, langCode);
    if (localAnswer) {
      appendAssistantMessage(localAnswer, langCode);
      return;
    }

    const payload = {
      contents: updatedHistory,
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }],
      },
    };

    try {
      const apiKey = getGeminiApiKey();
      if (!apiKey) {
        const fallbackMessage =
          langCode === "hi-IN"
            ? "बिना Gemini API कुंजी के मैं केवल सीमित सहायता दे सकता हूँ। कृपया .env फ़ाइल में REACT_APP_GEMINI_API_KEY जोड़ें या अपने व्यवस्थापक से संपर्क करें।"
            : langCode === "en-IN"
            ? "Bro, mujhe Gemini API key nahi mili. .env me REACT_APP_GEMINI_API_KEY add karo tab main full power pe aaunga."
            : "I need a Gemini API key to answer that. Please add REACT_APP_GEMINI_API_KEY to your environment and reload.";
        appendAssistantMessage(fallbackMessage, langCode);
        return;
      }

      const responseText = await fetchWithBackoff(payload);
      if (!responseText) {
        appendAssistantMessage(
          langCode === "hi-IN"
            ? "मुझे अभी उत्तर देने में परेशानी हो रही है, कृपया पुनः प्रयास करें।"
            : langCode === "en-IN"
            ? "Network thoda busy hai bro, thodi der baad try karte hain."
            : "I'm having trouble reaching the assistant right now. Please try again shortly.",
          langCode
        );
        return;
      }
      processAiResponse(responseText);
      } catch (err) {
      console.error("Assistant error", err);
      appendAssistantMessage(
        langCode === "hi-IN"
          ? "क्षमा करें, अभी मैं उत्तर नहीं दे सका।"
          : langCode === "en-IN"
          ? "Sorry bro, abhi thoda issue aa gaya."
          : "Sorry, I wasn't able to process that just now.",
        langCode
      );
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage(event);
    }
  };

  const triggerReport = () => {
    const langCode =
      state.currentLanguage === "hi"
        ? "hi-IN"
        : detectLanguageCode(state.currentLanguage);
    if (!reportData.hasData) {
      appendAssistantMessage(
        langCode === "hi-IN"
          ? "रिपोर्ट बनाने के लिए पहले इन्वेंटरी या बिक्री डेटा जोड़ें।"
          : "Please add some inventory or sales data so I can prepare the report.",
        langCode
      );
      return;
    }
    const summary = buildReportSummary(reportData, langCode);
    appendAssistantMessage(summary, langCode);
    setLastReportText(summary);
    setReportTimestamp(new Date());
  };

  const triggerGraph = () => {
    const langCode =
      state.currentLanguage === "hi"
        ? "hi-IN"
        : detectLanguageCode(state.currentLanguage);
    const graph = buildGraphConfig(reportData);
    if (graph) {
      setGraphConfig(graph);
      appendAssistantMessage(
        langCode === "hi-IN"
          ? "यह रहा बिक्री ग्राफ़।"
          : langCode === "en-IN"
          ? "Sales chart ready bro!"
          : "Displaying the sales graph now.",
        langCode
      );
    } else {
      appendAssistantMessage(
        langCode === "hi-IN"
          ? "ग्राफ़ दिखाने के लिए पर्याप्त डेटा नहीं मिला।"
          : "I couldn't find enough data to draw the graph yet.",
        langCode
      );
    }
  };

  const triggerDownload = () => {
    const langCode =
      state.currentLanguage === "hi"
        ? "hi-IN"
        : detectLanguageCode(state.currentLanguage);
    if (!reportData.hasData) {
      appendAssistantMessage(
        langCode === "hi-IN"
          ? "PDF डाउनलोड करने के लिए कुछ डेटा जोड़ें।"
          : "Add some inventory or sales data before downloading the PDF.",
        langCode
      );
      return;
    }
    const filename = createPdfReport(
      reportData,
      state.storeName || state.currentUser?.storeName || "Inventory Overview"
    );
    appendAssistantMessage(
      langCode === "hi-IN"
        ? `रिपोर्ट ${filename} नाम से डाउनलोड हो गई है।`
        : `Downloaded the report as ${filename}.`,
      langCode
    );
  };

  return (
    <div className="relative min-h-[calc(100vh-120px)] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4 py-10 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
            <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-purple-600 text-white">
                <BrainIcon className={`h-6 w-6 ${isSpeaking ? "animate-spin" : ""}`} />
              </span>
              Vox Assistant
        </h1>
            <p className="mt-1 text-sm text-slate-300">
              Multilingual voice assistant for inventory insights, analytics, and quick automation.
        </p>
      </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={triggerReport}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
              >
                Generate Report
        </button>
              <button
                type="button"
                onClick={triggerGraph}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-white/20 text-white/90 hover:bg-white/10 transition"
              >
                Show Sales Graph
        </button>
        <button
                type="button"
                onClick={triggerDownload}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-white/20 text-white/90 hover:bg-white/10 transition"
              >
                Download PDF
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleThemeQuickAction("dark")}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-white/20 text-white/90 hover:bg-white/10 transition"
              >
                Dark Mode
              </button>
              <button
                type="button"
                onClick={() => handleThemeQuickAction("light")}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-white/20 text-white/90 hover:bg-white/10 transition"
              >
                Light Mode
              </button>
              <button
                type="button"
                onClick={handleClearChat}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-white/20 text-white/90 hover:bg-white/10 transition"
              >
                Clear Conversation
              </button>
              <button
                type="button"
          onClick={() => {
                  autoScrollRef.current = true;
                  scrollChatToBottom();
          }}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-white/20 text-white/90 hover:bg-white/10 transition"
        >
                Jump to Latest
        </button>
      </div>
              </div>
            </div>

        <div
          ref={appRef}
          className="relative flex flex-col rounded-3xl shadow-2xl border border-white/10 bg-[rgb(var(--bg-primary))]/85 backdrop-blur-xl text-[rgb(var(--text-primary))] overflow-hidden"
        >
          <header className="flex items-center justify-between px-5 py-4 bg-[rgb(var(--bg-secondary))] border-b border-[rgb(var(--border-primary))]">
            <div>
              <h2 className="text-lg font-semibold text-[rgb(var(--text-primary))]">Conversation</h2>
              <p className="text-xs text-[rgb(var(--text-secondary))]">
                Ask me about inventory, dues, sales trends, theme changes, or general questions.
              </p>
                    </div>
            <button
              onClick={toggleListen}
              className={`inline-flex items-center justify-center w-10 h-10 rounded-full transition ${
                isListening ? "bg-red-500 text-white animate-pulse" : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              <MicIcon className="h-5 w-5" />
            </button>
          </header>

          <div
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-[rgb(var(--bg-chat))]"
          >
            {chatHistory.map((message, index) => (
              <ChatMessage key={`msg-${index}`} message={message} />
            ))}
            {isLoading && <LoadingIndicator />}
                  </div>

          {showScrollToLatest && (
            <button
              type="button"
              onClick={() => {
                autoScrollRef.current = true;
                scrollChatToBottom();
              }}
              className="absolute right-6 bottom-28 md:bottom-24 inline-flex items-center gap-2 rounded-full bg-blue-600 text-white px-3 py-2 text-xs font-medium shadow-lg hover:bg-blue-700 transition"
            >
              Latest
              <ChevronDownIcon className="h-4 w-4" />
            </button>
          )}

          {error && (
            <div className="px-5 py-3 text-sm bg-red-100 text-red-700 border-t border-red-200">
              <strong className="font-semibold">Error:</strong> {error}
            </div>
          )}

          <form onSubmit={handleSendMessage} className="px-5 py-4 bg-[rgb(var(--bg-secondary))] border-t border-[rgb(var(--border-primary))]">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={userInput}
                onChange={(event) => setUserInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message or tap the mic..."
                className="flex-1 px-4 py-2 text-sm rounded-full border border-[rgb(var(--border-primary))] bg-[rgb(var(--input-bg))] text-[rgb(var(--text-primary))] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                disabled={isLoading || isListening || isSpeaking}
              />
              <button
                type="submit"
                disabled={isLoading || isListening || !userInput.trim()}
                className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <LoaderIcon className="h-5 w-5 animate-spin" />
                ) : (
                  <SendIcon className="h-5 w-5" />
                )}
              </button>
            </div>
          </form>
        </div>

        {graphConfig && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Sales Graph</h3>
              <button
                onClick={() => setGraphConfig(null)}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                Close
            </button>
          </div>
            <div className="h-64">
              <Bar data={graphConfig.data} options={graphConfig.options} />
        </div>
      </div>
        )}

        {lastReportText && (
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-gray-900">Latest Summary</h3>
              <span className="text-xs text-gray-500">
                {reportTimestamp ? reportTimestamp.toLocaleString() : ""}
              </span>
              </div>
            <pre className="text-sm text-gray-700 whitespace-pre-wrap leading-6">
              {lastReportText}
            </pre>
              </div>
        )}
            </div>
    </div>
  );
};

const ChatMessage = ({ message }) => {
  const isUser = message.role === "user";
  const text = message.parts?.[0]?.text || "";
  const isHindi = /[\u0900-\u097F]/.test(text);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-lg md:max-w-2xl inline-flex items-start gap-3 ${
          isUser ? "flex-row-reverse" : "flex-row"
        }`}
      >
        <span className="flex h-8 w-8 shrink-0 overflow-hidden rounded-full">
          <div className="flex h-full w-full items-center justify-center rounded-full bg-gray-200 text-gray-700">
            {isUser ? (
              <UserIcon className="h-4 w-4" />
            ) : (
              <BotIcon className="h-4 w-4" />
            )}
                    </div>
        </span>
        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-6 ${
            isUser
              ? "bg-blue-600 text-white"
              : "bg-[rgb(var(--bubble-bot))] text-[rgb(var(--text-primary))] border border-[rgb(var(--border-primary))]"
          } ${isHindi ? "font-[Noto Sans Devanagari,Inter,sans-serif]" : "font-sans"}`}
          style={{ whiteSpace: "pre-wrap" }}
        >
          {text}
                  </div>
            </div>
    </div>
  );
};

const LoadingIndicator = () => (
  <div className="flex items-start gap-3 justify-start">
    <span className="flex h-8 w-8 shrink-0 overflow-hidden rounded-full">
      <div className="flex h-full w-full items-center justify-center rounded-full bg-gray-200 text-gray-700">
        <BotIcon className="h-4 w-4" />
            </div>
    </span>
    <div className="px-3 py-2 rounded-2xl bg-[rgb(var(--bubble-bot))] border border-[rgb(var(--border-primary))]">
      <div className="flex items-center gap-1">
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0s" }} />
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.15s" }} />
        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.3s" }} />
          </div>
        </div>
    </div>
  );

export default Assistant;
