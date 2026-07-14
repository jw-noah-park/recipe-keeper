import { supabase } from "../config/supabase.js";

function validateRecipePayload({
  title,
  ingredients,
  instructions,
  originalServings,
}) {
  if (!title || !title.trim()) {
    return {
      error: "Recipe title is required.",
    };
  }

  if (!Array.isArray(ingredients)) {
    return {
      error: "Ingredients must be an array.",
    };
  }

  if (!Array.isArray(instructions)) {
    return {
      error: "Instructions must be an array.",
    };
  }

  let servings = null;

  if (
    originalServings !== "" &&
    originalServings !== null &&
    originalServings !== undefined
  ) {
    servings = Number(originalServings);

    if (!Number.isFinite(servings) || servings <= 0) {
      return {
        error: "Original servings must be greater than zero.",
      };
    }
  }

  return {
    data: {
      title: title.trim(),
      ingredients: ingredients
        .map((ingredient) => ingredient.trim())
        .filter(Boolean),
      instructions: instructions
        .map((instruction) => instruction.trim())
        .filter(Boolean),
      original_servings: servings,
    },
  };
}

/*
GET /api/recipes
저장된 레시피 전체 조회
*/
export async function getRecipes(req, res) {
  try {
    const { data, error } = await supabase
      .from("recipes")
      .select("*")
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("getRecipes error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve recipes.",
    });
  }
}

/*
POST /api/recipes
정리된 레시피 저장
*/
export async function createRecipe(req, res) {
  try {
    const { title, rawText, ingredients, instructions, originalServings } =
      req.body;

    if (!rawText || !rawText.trim()) {
      return res.status(400).json({
        success: false,
        message: "Original recipe text is required.",
      });
    }

    const validationResult = validateRecipePayload({
      title,
      ingredients,
      instructions,
      originalServings,
    });

    if (validationResult.error) {
      return res.status(400).json({
        success: false,
        message: validationResult.error,
      });
    }

    const { data, error } = await supabase
      .from("recipes")
      .insert({
        ...validationResult.data,
        raw_text: rawText.trim(),
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.status(201).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("createRecipe error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create recipe.",
    });
  }
}

/*
PATCH /api/recipes/:id
저장된 레시피 수정
*/
export async function updateRecipe(req, res) {
  try {
    const { id } = req.params;
    const { title, ingredients, instructions, originalServings } = req.body;

    const validationResult = validateRecipePayload({
      title,
      ingredients,
      instructions,
      originalServings,
    });

    if (validationResult.error) {
      return res.status(400).json({
        success: false,
        message: validationResult.error,
      });
    }

    const { data, error } = await supabase
      .from("recipes")
      .update(validationResult.data)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("updateRecipe error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update recipe.",
    });
  }
}
