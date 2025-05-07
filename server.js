require("dotenv").config();
const express = require("express");
const axios = require("axios");
const path = require("path");
const expressLayouts = require("express-ejs-layouts");
const mysql = require("mysql2/promise");
const session = require("express-session");
const bcrypt = require("bcrypt");

const app = express();
const port = process.env.PORT || 3000;

const dbHost = "10.9.0.60";
const dbName = "s2301348_1";
const dbUser = "s2301348";
const dbPwd = "Smq_vxiS";

// Create database connection pool
const pool = mysql.createPool({
  host: dbHost,
  user: dbUser,
  password: dbPwd,
  database: dbName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Set up session middleware
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }, // Set to true if using HTTPS
  })
);

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.redirect("/login");
  }
};

// Middleware to make user data available to all views
app.use((req, res, next) => {
  res.locals.user = req.session.user;
  next();
});

// Set EJS as templating engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Set up express-ejs-layouts
app.use(expressLayouts);
app.set("layout", "layout");
app.set("layout extractScripts", true);
app.set("layout extractStyles", true);

// Serve static files
app.use(express.static(path.join(__dirname, "includes")));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Authentication routes
app.get("/login", (req, res) => {
  if (req.session.user) {
    res.redirect("/");
  } else {
    res.render("login", { error: null });
  }
});

// Route handler for handling logins
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const [users] = await pool.query("SELECT * FROM users WHERE username = ?", [
      username,
    ]);

    if (users.length === 0) {
      return res.render("login", { error: "Invalid username or password" });
    }

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.render("login", { error: "Invalid username or password" });
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      email: user.email,
    };

    res.redirect("/");
  } catch (error) {
    console.error("Login error:", error);
    res.render("login", { error: "An error occurred during login" });
  }
});

app.get("/register", (req, res) => {
  if (req.session.user) {
    res.redirect("/");
  } else {
    res.render("register", { error: null });
  }
});

// Handles post request for user registration
app.post("/register", async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;

    // Password validation regex
    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

    if (!passwordRegex.test(password)) {
      return res.render("register", {
        error:
          "Password must be at least 8 characters long, include both uppercase and lowercase letters and special characters.",
      });
    }

    if (password !== confirmPassword) {
      return res.render("register", { error: "Passwords do not match" });
    }

    // Check if username or email already exists
    const [existingUsers] = await pool.query(
      "SELECT * FROM users WHERE username = ? OR email = ?",
      [username, email]
    );

    if (existingUsers.length > 0) {
      return res.render("register", {
        error: "Username or email already exists",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user
    await pool.query(
      "INSERT INTO users (username, email, password) VALUES (?, ?, ?)",
      [username, email, hashedPassword]
    );

    res.redirect("/login");
  } catch (error) {
    console.error("Registration error:", error);
    res.render("register", { error: "An error occurred during registration" });
  }
});

// Routes
app.get("/", async (req, res) => {
  try {
    // Fetch categories from TheMealDB API
    const response = await axios.get(
      "https://www.themealdb.com/api/json/v1/1/categories.php"
    );
    const categories = response.data.categories;
    res.render("index", { categories, error: null });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.render("index", {
      categories: [],
      error: "Failed to load categories",
    });
  }
});

// Search routes
app.get("/search", async (req, res) => {
  try {
    const { query, type } = req.query;
    let response;

    if (type === "ingredient") {
      response = await axios.get(
        `https://www.themealdb.com/api/json/v1/1/filter.php?i=${query}`
      );
    } else {
      response = await axios.get(
        `https://www.themealdb.com/api/json/v1/1/search.php?s=${query}`
      );
    }

    const meals = response.data.meals || [];
    res.render("search", {
      meals,
      query,
      type,
      error: null,
    });
  } catch (error) {
    console.error("Error searching recipes:", error);
    res.render("search", {
      meals: [],
      query: req.query.query,
      type: req.query.type,
      error: "Failed to search recipes",
    });
  }
});

// Route handler for displaying meals for each category
app.get("/category/:category", async (req, res) => {
  try {
    const category = req.params.category;
    const response = await axios.get(
      `https://www.themealdb.com/api/json/v1/1/filter.php?c=${category}`
    );
    const meals = response.data.meals;
    res.render("category", { meals, category, error: null });
  } catch (error) {
    console.error("Error fetching meals:", error);
    res.render("category", {
      meals: [],
      category: req.params.category,
      error: "Failed to load meals",
    });
  }
});

// Route handler for displaying recipes
app.get("/recipe/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const response = await axios.get(
      `https://www.themealdb.com/api/json/v1/1/lookup.php?i=${id}`
    );
    const recipe = response.data.meals[0];

    // Fetch ratings for this recipe
    const [ratings] = await pool.query(
      `SELECT r.*, u.username 
       FROM ratings r 
       JOIN users u ON r.user_id = u.id 
       WHERE r.recipe_id = ? 
       ORDER BY r.created_at DESC`,
      [id]
    );

    res.render("recipe", { recipe, ratings, error: null });
  } catch (error) {
    console.error("Error fetching recipe:", error);
    res.render("recipe", {
      recipe: null,
      ratings: [],
      error: "Failed to load recipe",
    });
  }
});

// Rating route
app.post("/recipe/:id/rate", isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;
    const userId = req.session.user.id;

    // Check if user has already rated this recipe
    const [existingRating] = await pool.query(
      "SELECT * FROM ratings WHERE user_id = ? AND recipe_id = ?",
      [userId, id]
    );

    if (existingRating.length > 0) {
      // Update existing rating
      await pool.query(
        "UPDATE ratings SET rating = ?, comment = ? WHERE user_id = ? AND recipe_id = ?",
        [rating, comment, userId, id]
      );
    } else {
      // Insert new rating
      await pool.query(
        "INSERT INTO ratings (user_id, recipe_id, rating, comment) VALUES (?, ?, ?, ?)",
        [userId, id, rating, comment]
      );
    }

    res.redirect(`/recipe/${id}`);
  } catch (error) {
    console.error("Rating error:", error);
    res.redirect(`/recipe/${id}`);
  }
});

app.post("/recipe/:id/favorite", isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { recipe_name, recipe_thumbnail } = req.body;
  const userId = req.session.user.id;

  try {
    // Add the favorite
    await pool.query(
      "INSERT INTO favorites (user_id, recipe_id, recipe_name, recipe_thumbnail) VALUES (?, ?, ?, ?)",
      [userId, id, recipe_name, recipe_thumbnail]
    );

    // Fetch updated favorites after adding
    const [favorites] = await pool.query(
      "SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );

    // Re-render the profile page with the updated favorites
    res.render("profile", { favorites });
  } catch (error) {
    console.error("Error adding favorite:", error);
    res.redirect(`/recipe/${id}`);
  }
});

// Logout route
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
      return res.redirect("/");
    }
    res.redirect("/login");
  });
});

// Profile route
app.get("/profile", isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.user.id;
    // Fetch the user's favorites
    const [favorites] = await pool.query(
      "SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    );
    // Render the profile page with the user's favorites
    res.render("profile", { favorites });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.render("profile", { favorites: [], error: "Failed to load profile" });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
