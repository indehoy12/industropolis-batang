// Urutan = urutan di gambar sumber (dipakai saat logo dibagikan otomatis ke tim berurutan).
// Pustaka logo klub bawaan: file PNG transparan 512 x 512 px di assets/logos/.
// Alamat absolut (/assets/...) supaya sama-sama jalan di website publik dan di /admin/.
export const LOGO_DIR = "/assets/logos/";
export const LOGO_LIBRARY = [
  { file: "bayern-munchen", name: "Bayern Munchen", alias: ["bayern", "bayern munchen", "bayern munich", "fcb munchen"] },
  { file: "ac-milan", name: "AC Milan", alias: ["ac milan", "milan", "acm"] },
  { file: "psg", name: "Paris Saint-Germain", alias: ["psg", "paris", "paris saint germain", "paris saint-germain"] },
  { file: "inter-milan", name: "Inter Milan", alias: ["inter", "inter milan", "internazionale"] },
  { file: "barcelona", name: "FC Barcelona", alias: ["barcelona", "barca", "fcb"] },
  { file: "dortmund", name: "Borussia Dortmund", alias: ["dortmund", "borussia dortmund", "bvb"] },
  { file: "juventus", name: "Juventus", alias: ["juventus", "juve"] },
  { file: "real-madrid", name: "Real Madrid", alias: ["real madrid", "real", "rma"] },
  { file: "liverpool", name: "Liverpool", alias: ["liverpool", "lfc"] },
  { file: "man-city", name: "Manchester City", alias: ["man city", "manchester city", "city", "mci"] },
  { file: "atletico-madrid", name: "Atletico Madrid", alias: ["atletico", "atletico madrid", "atm"] },
  { file: "leverkusen", name: "Bayer Leverkusen", alias: ["leverkusen", "bayer leverkusen"] },
  { file: "chelsea", name: "Chelsea", alias: ["chelsea", "che"] },
  { file: "arsenal", name: "Arsenal", alias: ["arsenal", "ars"] },
];
export const logoPath = (file) => `${LOGO_DIR}${file}.png`;
