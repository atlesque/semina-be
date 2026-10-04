      const basicWords = [
        { word: "Apple", emoji: "🍎" },
        { word: "Banana", emoji: "🍌" },
        { word: "Orange", emoji: "🍊" },
        { word: "Lemon", emoji: "🍋" },
        { word: "Cookie", emoji: "🍪" },
        { word: "Muffin", emoji: "🧁" },
        { word: "Pancake", emoji: "🥞" },
        { word: "Noodle", emoji: "🍜" },
        { word: "Pizza", emoji: "🍕" },
        { word: "Burger", emoji: "🍔" },
        { word: "Forest", emoji: "🌲" },
        { word: "Garden", emoji: "🌿" },
        { word: "Flower", emoji: "🌸" },
        { word: "Kitten", emoji: "🐱" },
        { word: "Dolphin", emoji: "🐬" },
        { word: "Penguin", emoji: "🐧" },
        { word: "Planet", emoji: "🪐" },
        { word: "Glitter", emoji: "✨" },
        { word: "Melody", emoji: "🎵" },
        { word: "Piano", emoji: "🎹" },
        { word: "Pixel", emoji: "🟪" },
      ];
      const customWords = [
        { word: "Admin", emoji: "🧑‍💼" },
        { word: "Shauni", emoji: "🫶" },
        { word: "MBP", emoji: "💻" },
        { word: "Analist", emoji: "📊" },
        { word: "Macedonia", emoji: "🇲🇰" },
        { word: "Fashion", emoji: "👗" },
        { word: "Pini", emoji: "🌲" },
        { word: "Semina", emoji: "🌱" },
        { word: "Mini", emoji: "🔹" },
        { word: "Krul", emoji: "🌀" },
        { word: "Kroket", emoji: "🥔" },
        { word: "Optimi", emoji: "🚀" },
        { word: "Tauri", emoji: "♉" },
        { word: "Santori", emoji: "🕯️" },
        { word: "Wafel", emoji: "🧇" },
        { word: "Trouwring", emoji: "💍" },
        { word: "Griss", emoji: "🪶" },
        { word: "Contactvoorkeur", emoji: "📇" },
        { word: "Acronym", emoji: "🔤" },
      ];

      // Merge + deduplicate, then shuffle and loop through all words
      const allWords = [
        ...new Map(
          [...basicWords, ...customWords].map((entry) => [entry.word, entry]),
        ).values(),
      ];

window.PiniWords = allWords;
