import { useEffect, useRef, useState } from "react";
import { parseRecipeText } from "./utils/parseRecipeText.js";
import "./App.css";

const API_URL =
  import.meta.env.VITE_API_URL?.trim() || "http://localhost:5001/api";
const RECIPE_VIEW_COUNTS_STORAGE_KEY = "recipe_keeper_view_counts";

const FRACTION_CHAR_TO_PARTS = {
  "¼": [1, 4],
  "½": [1, 2],
  "¾": [3, 4],
  "⅓": [1, 3],
  "⅔": [2, 3],
  "⅛": [1, 8],
  "⅜": [3, 8],
  "⅝": [5, 8],
  "⅞": [7, 8],
};

const QUANTITY_TOKEN_PATTERN =
  /(^|[\s(])(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])(\s*(?:kg|g|mg|ml|l|cc|컵|공기|큰술|작은술|숟가락|스푼|국자|tsp|tbsp|ts|tb|T|t|개|장|줄|쪽|알|봉|팩|캔|줌|꼬집|인분|톨)?)?(?=[\s,()/]|$)/g;

const SCALABLE_GROUP_PATTERN =
  /(?:양념|양념장|다데기|다대기|소스|드레싱)/i;

function splitIngredientLabel(ingredient) {
  const match = ingredient.match(/^\[([^\]]+)\]\s*(.+)$/);

  if (!match) {
    return {
      group: "",
      text: ingredient,
    };
  }

  return {
    group: match[1],
    text: match[2],
  };
}

function toggleIngredientTag(ingredient, tagName) {
  const { group, text } = splitIngredientLabel(ingredient);

  if (group === tagName) {
    return text;
  }

  return `[${tagName}] ${text}`;
}

function isScalableIngredientGroup(groupName) {
  return SCALABLE_GROUP_PATTERN.test(groupName);
}

function moveArrayItem(items, fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);

  nextItems.splice(toIndex, 0, movedItem);

  return nextItems;
}

function createRecipeDraft(recipe) {
  return {
    title: recipe.title ?? "",
    originalServings:
      recipe.original_servings === null ||
      recipe.original_servings === undefined ||
      recipe.original_servings === ""
        ? ""
        : String(recipe.original_servings),
    ingredients:
      Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0
        ? [...recipe.ingredients]
        : [""],
    instructions:
      Array.isArray(recipe.instructions) && recipe.instructions.length > 0
        ? [...recipe.instructions]
        : [""],
  };
}

function matchesRecipe(recipe, query) {
  if (!query) {
    return true;
  }

  const haystack = (recipe.title ?? "").toLowerCase();

  return haystack.includes(query);
}

function greatestCommonDivisor(a, b) {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

function normalizeFractionParts(numerator, denominator) {
  if (denominator === 0) {
    return {
      numerator,
      denominator: 1,
    };
  }

  const sign = denominator < 0 ? -1 : 1;
  const absoluteNumerator = Math.abs(numerator);
  const absoluteDenominator = Math.abs(denominator);
  const divisor = greatestCommonDivisor(
    absoluteNumerator,
    absoluteDenominator,
  );

  return {
    numerator: sign * (numerator / divisor),
    denominator: absoluteDenominator / divisor,
  };
}

function decimalToFractionParts(token) {
  const [wholePart, decimalPart = ""] = token.split(".");
  const denominator = 10 ** decimalPart.length;
  const numerator = Number(`${wholePart}${decimalPart}`);

  return normalizeFractionParts(numerator, denominator);
}

function parseQuantityToken(token) {
  if (FRACTION_CHAR_TO_PARTS[token]) {
    const [numerator, denominator] = FRACTION_CHAR_TO_PARTS[token];

    return { numerator, denominator };
  }

  const mixedFractionMatch = token.match(/^(\d+)\s+(\d+)\/(\d+)$/);

  if (mixedFractionMatch) {
    const [, whole, numerator, denominator] = mixedFractionMatch;

    return normalizeFractionParts(
      Number(whole) * Number(denominator) + Number(numerator),
      Math.max(1, Number(denominator)),
    );
  }

  const fractionMatch = token.match(/^(\d+)\/(\d+)$/);

  if (fractionMatch) {
    const [, numerator, denominator] = fractionMatch;

    return normalizeFractionParts(
      Number(numerator),
      Math.max(1, Number(denominator)),
    );
  }

  if (token.includes(".")) {
    return decimalToFractionParts(token);
  }

  return {
    numerator: Number(token),
    denominator: 1,
  };
}

function formatShortNumber(value) {
  const rounded = Math.round(value * 100) / 100;

  if (Number.isInteger(rounded)) {
    return String(rounded);
  }

  return String(rounded).replace(/\.?0+$/, "");
}

function scaleToFractionParts(scale) {
  if (Number.isInteger(scale)) {
    return {
      numerator: scale,
      denominator: 1,
    };
  }

  return decimalToFractionParts(String(scale));
}

function formatScaledQuantity(parts) {
  const normalizedParts = normalizeFractionParts(
    parts.numerator,
    parts.denominator,
  );

  if (normalizedParts.denominator === 1) {
    return String(normalizedParts.numerator);
  }

  const absoluteNumerator = Math.abs(normalizedParts.numerator);
  const whole = Math.floor(absoluteNumerator / normalizedParts.denominator);
  const remainder = absoluteNumerator % normalizedParts.denominator;
  const sign = normalizedParts.numerator < 0 ? "-" : "";

  if (whole === 0) {
    return `${sign}${remainder}/${normalizedParts.denominator}`;
  }

  if (remainder === 0) {
    return `${sign}${whole}`;
  }

  return `${sign}${whole} ${remainder}/${normalizedParts.denominator}`;
}

function multiplyFractionParts(left, right) {
  return normalizeFractionParts(
    left.numerator * right.numerator,
    left.denominator * right.denominator,
  );
}

function fractionPartsToNumber(parts) {
  return parts.numerator / parts.denominator;
}


function scaleIngredientText(ingredient, scale) {
  if (scale === 1) {
    return ingredient;
  }

  const { group, text } = splitIngredientLabel(ingredient);

  if (!isScalableIngredientGroup(group)) {
    return ingredient;
  }

  const scaledText = text.replace(
    QUANTITY_TOKEN_PATTERN,
    (match, prefix, quantity, suffix = "") => {
      const parsedQuantity = parseQuantityToken(quantity);
      const scaleParts = scaleToFractionParts(scale);
      const scaledQuantity = multiplyFractionParts(parsedQuantity, scaleParts);

      if (!Number.isFinite(fractionPartsToNumber(scaledQuantity))) {
        return match;
      }

      const nextQuantity = formatScaledQuantity(scaledQuantity);

      return `${prefix}${nextQuantity}${suffix}`;
    },
  );

  return group ? `[${group}] ${scaledText}` : scaledText;
}

function formatScaleLabel(scale) {
  return `x${formatShortNumber(scale)}`;
}

function loadRecipeViewCounts() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const storedValue = window.localStorage.getItem(
      RECIPE_VIEW_COUNTS_STORAGE_KEY,
    );

    if (!storedValue) {
      return {};
    }

    const parsedValue = JSON.parse(storedValue);

    return parsedValue && typeof parsedValue === "object" ? parsedValue : {};
  } catch {
    return {};
  }
}

function App() {
  const [recipes, setRecipes] = useState([]);

  const [rawText, setRawText] = useState("");
  const [title, setTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isPastePanelOpen, setIsPastePanelOpen] = useState(true);

  const [ingredients, setIngredients] = useState([]);
  const [instructions, setInstructions] = useState([]);

  const [editingRecipeId, setEditingRecipeId] = useState(null);
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [openRecipeId, setOpenRecipeId] = useState(null);
  const [recipeScales, setRecipeScales] = useState({});
  const [recipeViewCounts, setRecipeViewCounts] = useState(loadRecipeViewCounts);

  const [hasParsed, setHasParsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingRecipeId, setUpdatingRecipeId] = useState(null);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [titleError, setTitleError] = useState("");
  const [editingTitleError, setEditingTitleError] = useState("");

  const titleInputRef = useRef(null);
  const editTitleInputRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchRecipes() {
      try {
        const response = await fetch(`${API_URL}/recipes`, {
          signal: controller.signal,
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.message || "Failed to retrieve recipes.");
        }

        setRecipes(result.data);
      } catch (error) {
        if (error.name !== "AbortError") {
          setError(error.message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    fetchRecipes();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!editingRecipeId) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setEditingRecipeId(null);
        setEditingRecipe(null);
      }
    }

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editingRecipeId]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredRecipes = [...recipes]
    .filter((recipe) => matchesRecipe(recipe, normalizedSearchQuery))
    .sort((leftRecipe, rightRecipe) => {
      const leftCount = recipeViewCounts[leftRecipe.id] ?? 0;
      const rightCount = recipeViewCounts[rightRecipe.id] ?? 0;

      if (rightCount !== leftCount) {
        return rightCount - leftCount;
      }

      return new Date(rightRecipe.created_at) - new Date(leftRecipe.created_at);
    });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      RECIPE_VIEW_COUNTS_STORAGE_KEY,
      JSON.stringify(recipeViewCounts),
    );
  }, [recipeViewCounts]);

  function getRecipeScale(recipeId) {
    return recipeScales[recipeId] ?? 1;
  }

  function toggleRecipeOpen(recipeId) {
    const isOpening = openRecipeId !== recipeId;

    setOpenRecipeId(isOpening ? recipeId : null);

    if (isOpening) {
      setRecipeViewCounts((currentCounts) => ({
        ...currentCounts,
        [recipeId]: (currentCounts[recipeId] ?? 0) + 1,
      }));
    }
  }

  function increaseRecipeScale(recipeId) {
    setRecipeScales((currentScales) => ({
      ...currentScales,
      [recipeId]: (() => {
        const currentScale = currentScales[recipeId] ?? 1;

        if (currentScale < 1) {
          return Math.min(currentScale * 2, 1);
        }

        return Math.min(currentScale + 1, 6);
      })(),
    }));
  }

  function decreaseRecipeScale(recipeId) {
    setRecipeScales((currentScales) => ({
      ...currentScales,
      [recipeId]: (() => {
        const currentScale = currentScales[recipeId] ?? 1;

        if (currentScale <= 1) {
          return Math.max(currentScale / 2, 0.25);
        }

        return Math.max(currentScale - 1, 1);
      })(),
    }));
  }

  function handleParseRecipe() {
    if (!rawText.trim()) {
      setError("레시피 원문을 붙여넣어 주세요.");
      setSuccessMessage("");
      return;
    }

    const parsedRecipe = parseRecipeText(rawText);

    setTitle(parsedRecipe.title ?? "");
    setIngredients(parsedRecipe.ingredients);
    setInstructions(parsedRecipe.instructions);
    setHasParsed(true);
    setError("");
    setSuccessMessage("");
    setTitleError("");
  }

  function handleIngredientChange(index, value) {
    setIngredients((currentIngredients) =>
      currentIngredients.map((ingredient, ingredientIndex) =>
        ingredientIndex === index ? value : ingredient,
      ),
    );
  }

  function addIngredient() {
    setIngredients((currentIngredients) => [...currentIngredients, ""]);
  }

  function removeIngredient(index) {
    setIngredients((currentIngredients) =>
      currentIngredients.filter(
        (_, ingredientIndex) => ingredientIndex !== index,
      ),
    );
  }

  function moveIngredient(index, direction) {
    setIngredients((currentIngredients) =>
      moveArrayItem(currentIngredients, index, index + direction),
    );
  }

  function handleInstructionChange(index, value) {
    setInstructions((currentInstructions) =>
      currentInstructions.map((instruction, instructionIndex) =>
        instructionIndex === index ? value : instruction,
      ),
    );
  }

  function addInstruction() {
    setInstructions((currentInstructions) => [...currentInstructions, ""]);
  }

  function removeInstruction(index) {
    setInstructions((currentInstructions) =>
      currentInstructions.filter(
        (_, instructionIndex) => instructionIndex !== index,
      ),
    );
  }

  function updateEditingRecipeField(field, value) {
    if (field === "title") {
      setEditingTitleError("");
    }

    setEditingRecipe((currentRecipe) => ({
      ...currentRecipe,
      [field]: value,
    }));
  }

  function handleEditingIngredientChange(index, value) {
    setEditingRecipe((currentRecipe) => ({
      ...currentRecipe,
      ingredients: currentRecipe.ingredients.map((ingredient, ingredientIndex) =>
        ingredientIndex === index ? value : ingredient,
      ),
    }));
  }

  function addEditingIngredient() {
    setEditingRecipe((currentRecipe) => ({
      ...currentRecipe,
      ingredients: [...currentRecipe.ingredients, ""],
    }));
  }

  function removeEditingIngredient(index) {
    setEditingRecipe((currentRecipe) => ({
      ...currentRecipe,
      ingredients: currentRecipe.ingredients.filter(
        (_, ingredientIndex) => ingredientIndex !== index,
      ),
    }));
  }

  function moveEditingIngredient(index, direction) {
    setEditingRecipe((currentRecipe) => ({
      ...currentRecipe,
      ingredients: moveArrayItem(
        currentRecipe.ingredients,
        index,
        index + direction,
      ),
    }));
  }

  function handleEditingInstructionChange(index, value) {
    setEditingRecipe((currentRecipe) => ({
      ...currentRecipe,
      instructions: currentRecipe.instructions.map(
        (instruction, instructionIndex) =>
          instructionIndex === index ? value : instruction,
      ),
    }));
  }

  function addEditingInstruction() {
    setEditingRecipe((currentRecipe) => ({
      ...currentRecipe,
      instructions: [...currentRecipe.instructions, ""],
    }));
  }

  function removeEditingInstruction(index) {
    setEditingRecipe((currentRecipe) => ({
      ...currentRecipe,
      instructions: currentRecipe.instructions.filter(
        (_, instructionIndex) => instructionIndex !== index,
      ),
    }));
  }

  function startEditingRecipe(recipe) {
    setEditingRecipeId(recipe.id);
    setEditingRecipe(createRecipeDraft(recipe));
    setError("");
    setSuccessMessage("");
    setEditingTitleError("");
  }

  function cancelEditingRecipe() {
    setEditingRecipeId(null);
    setEditingRecipe(null);
  }

  function resetForm() {
    setRawText("");
    setTitle("");
    setIngredients([]);
    setInstructions([]);
    setHasParsed(false);
    setTitleError("");
  }

  async function handleSaveRecipe() {
    if (!title.trim()) {
      setTitleError("레시피 제목을 입력해 주세요.");
      setError("");
      setSuccessMessage("");
      titleInputRef.current?.focus();
      return;
    }

    if (!rawText.trim()) {
      setError("레시피 원문이 없습니다.");
      setSuccessMessage("");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setSuccessMessage("");
      setTitleError("");

      const response = await fetch(`${API_URL}/recipes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          rawText,
          ingredients,
          instructions,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Failed to save recipe.");
      }

      setRecipes((currentRecipes) => [result.data, ...currentRecipes]);

      setSuccessMessage(`"${result.data.title}" 레시피가 저장되었습니다.`);
      window.alert(`"${result.data.title}" 레시피가 저장되었습니다.`);
      resetForm();
    } catch (error) {
      setError(error.message);
      setSuccessMessage("");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateRecipe(recipeId) {
    if (!editingRecipe.title.trim()) {
      setEditingTitleError("레시피 제목을 입력해 주세요.");
      setError("");
      setSuccessMessage("");
      editTitleInputRef.current?.focus();
      return;
    }

    try {
      setUpdatingRecipeId(recipeId);
      setError("");
      setSuccessMessage("");
      setEditingTitleError("");

      const response = await fetch(`${API_URL}/recipes/${recipeId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: editingRecipe.title,
          originalServings: editingRecipe.originalServings,
          ingredients: editingRecipe.ingredients,
          instructions: editingRecipe.instructions,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Failed to update recipe.");
      }

      setRecipes((currentRecipes) =>
        currentRecipes.map((recipe) =>
          recipe.id === recipeId ? result.data : recipe,
        ),
      );

      setSuccessMessage(`"${result.data.title}" 레시피가 수정되었습니다.`);
      window.alert(`"${result.data.title}" 레시피가 수정되었습니다.`);
      cancelEditingRecipe();
    } catch (error) {
      setError(error.message);
      setSuccessMessage("");
    } finally {
      setUpdatingRecipeId(null);
    }
  }

  function toggleEditingIngredientTag(index, tagName) {
    setEditingRecipe((currentRecipe) => ({
      ...currentRecipe,
      ingredients: currentRecipe.ingredients.map((ingredient, ingredientIndex) =>
        ingredientIndex === index
          ? toggleIngredientTag(ingredient, tagName)
          : ingredient,
      ),
    }));
  }

  return (
    <>
      <main className="app">
        {error && <p className="error-message">{error}</p>}
        {successMessage && <p className="success-message">{successMessage}</p>}

        <section className="panel">
          <div className="panel-toggle-row">
            <h2>레시피 붙여넣기</h2>

            <button
              type="button"
              className="ghost-button panel-toggle-button"
              onClick={() => setIsPastePanelOpen((currentValue) => !currentValue)}
              aria-expanded={isPastePanelOpen}
              aria-label={isPastePanelOpen ? "레시피 붙여넣기 접기" : "레시피 붙여넣기 펼치기"}
            >
              <span
                className={`panel-toggle-button-icon${
                  isPastePanelOpen ? " panel-toggle-button-icon-open" : ""
                }`}
                aria-hidden="true"
              >
                ^
              </span>
            </button>
          </div>

          {isPastePanelOpen && (
            <>
              <label htmlFor="rawText">레시피 전체 내용</label>

              <textarea
                id="rawText"
                rows="16"
                value={rawText}
                onChange={(event) => setRawText(event.target.value)}
                placeholder="레시피 전체를 여기에 붙여넣으세요."
              />

              <button
                type="button"
                className="primary-button"
                onClick={handleParseRecipe}
              >
                레시피 정리하기
              </button>
            </>
          )}
        </section>

        <section className="panel search-panel">
          <div className="recipes-panel-header">
            <div className="search-field search-field-wide">
              <label htmlFor="recipe-search" className="visually-hidden">
                레시피 검색
              </label>
              <input
                id="recipe-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="레시피 제목 검색"
              />
            </div>

            <p className="recipes-count">
              {loading ? "불러오는 중..." : `${filteredRecipes.length}개 표시 중`}
            </p>
          </div>
        </section>

        {hasParsed && (
          <section className="panel">
            <div className="panel-title-row">
              <h2>정리 결과</h2>

              <button
                type="button"
                className="save-button save-button-inline"
                onClick={handleSaveRecipe}
                disabled={saving}
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>

            <div className="field">
              <label htmlFor="title">레시피 제목</label>

              <input
                ref={titleInputRef}
                id="title"
                type="text"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setTitleError("");
                }}
                className={titleError ? "input-invalid" : ""}
                aria-invalid={titleError ? "true" : "false"}
                placeholder="예: 막김치"
              />

              {titleError && <p className="field-error-text">{titleError}</p>}
            </div>

            <div className="result-section">
              <div className="section-heading">
                <h3>재료</h3>

                <button
                  type="button"
                  className="ghost-button"
                  onClick={addIngredient}
                >
                  재료 추가
                </button>
              </div>

              {ingredients.length === 0 ? (
                <p>
                  재료를 자동으로 구분하지 못했습니다. 필요한 경우 직접 추가해
                  주세요.
                </p>
              ) : (
                ingredients.map((ingredient, index) => (
                  <div className="editable-row" key={index}>
                    <input
                      type="text"
                      value={ingredient}
                      onChange={(event) =>
                        handleIngredientChange(index, event.target.value)
                      }
                    />

                    <div className="row-action-group">
                      <button
                        type="button"
                        className="ghost-button row-move-button"
                        onClick={() => moveIngredient(index, -1)}
                        disabled={index === 0}
                        aria-label="재료 위로 이동"
                      >
                        ↑
                      </button>

                      <button
                        type="button"
                        className="ghost-button row-move-button"
                        onClick={() => moveIngredient(index, 1)}
                        disabled={index === ingredients.length - 1}
                        aria-label="재료 아래로 이동"
                      >
                        ↓
                      </button>

                      <button
                        type="button"
                        className="ghost-button ingredient-delete-button"
                        onClick={() => removeIngredient(index)}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="result-section">
              <div className="section-heading">
                <h3>조리 순서</h3>

                <button
                  type="button"
                  className="ghost-button"
                  onClick={addInstruction}
                >
                  단계 추가
                </button>
              </div>

              {instructions.length === 0 ? (
                <p>번호가 있는 조리 단계를 자동으로 찾지 못했습니다.</p>
              ) : (
                instructions.map((instruction, index) => (
                  <div className="instruction-row" key={index}>
                    <strong>{index + 1}</strong>

                    <textarea
                      rows="3"
                      value={instruction}
                      onChange={(event) =>
                        handleInstructionChange(index, event.target.value)
                      }
                    />

                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => removeInstruction(index)}
                    >
                      삭제
                    </button>
                  </div>
                ))
              )}
            </div>

            <button
              type="button"
              className="save-button"
              onClick={handleSaveRecipe}
              disabled={saving}
            >
              {saving ? "저장 중..." : "레시피 저장"}
            </button>
          </section>
        )}

        <section className="panel">
          <h2>저장된 레시피</h2>

          {loading ? (
            <p>불러오는 중...</p>
          ) : recipes.length === 0 ? (
            <p>저장된 레시피가 없습니다.</p>
          ) : filteredRecipes.length === 0 ? (
            <p>검색 결과가 없습니다.</p>
          ) : (
            <div className="recipe-list">
              {filteredRecipes.map((recipe, index) => {
                const scale = getRecipeScale(recipe.id);
                const isRecipeOpen = openRecipeId === recipe.id;
                const recipeViewCount = recipeViewCounts[recipe.id] ?? 0;

                return (
                  <article
                    className={`recipe-card${
                      isRecipeOpen ? " recipe-card-open" : ""
                    }`}
                    key={recipe.id}
                  >
                    <button
                      type="button"
                      className="recipe-card-toggle"
                      onClick={() => toggleRecipeOpen(recipe.id)}
                      aria-expanded={isRecipeOpen}
                    >
                      <span className="recipe-card-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>

                      <span className="recipe-card-title-block">
                        <span className="recipe-card-title">{recipe.title}</span>
                      </span>

                      <span className="recipe-card-toggle-trailing">
                        <span className="recipe-card-view-count">
                          {recipeViewCount}
                        </span>
                        <span
                          className={`recipe-card-toggle-icon${
                            isRecipeOpen ? " recipe-card-toggle-icon-open" : ""
                          }`}
                          aria-hidden="true"
                        >
                          +
                        </span>
                      </span>
                    </button>

                    {isRecipeOpen && (
                      <div className="recipe-card-body">
                        <div className="recipe-card-meta">
                          <div className="recipe-meta-texts">
                            <p className="recipe-scale-text">
                              배율 {formatScaleLabel(scale)}
                            </p>
                          </div>

                          <div className="recipe-card-actions">
                            <div className="scale-controls">
                              <button
                                type="button"
                                className="scale-button"
                                onClick={() => decreaseRecipeScale(recipe.id)}
                                aria-label={`${recipe.title} 양 반으로 줄이기`}
                              >
                                -
                              </button>

                              <button
                                type="button"
                                className="scale-button"
                                onClick={() => increaseRecipeScale(recipe.id)}
                                aria-label={`${recipe.title} 양 두 배로 늘리기`}
                              >
                                +
                              </button>
                            </div>

                            <button
                              type="button"
                              className="edit-button"
                              onClick={() => startEditingRecipe(recipe)}
                            >
                              수정
                            </button>
                          </div>
                        </div>

                        <div className="recipe-section-header">
                          <h4>재료</h4>
                        </div>

                        {recipe.ingredients?.length > 0 ? (
                          <ul className="ingredient-list">
                            {recipe.ingredients.map((ingredient, ingredientIndex) => {
                              const scaledIngredient = scaleIngredientText(
                                ingredient,
                                scale,
                              );
                              const { group, text } =
                                splitIngredientLabel(scaledIngredient);

                              return (
                                <li key={ingredientIndex} className="ingredient-item">
                                  {group && (
                                    <span className="ingredient-group">{group}</span>
                                  )}
                                  <span>{text}</span>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p>분리된 재료가 없습니다.</p>
                        )}

                        <details className="recipe-details">
                          <summary>조리 순서 보기</summary>

                          <h4>조리 순서</h4>

                          {recipe.instructions?.length > 0 ? (
                            <ol>
                              {recipe.instructions.map((instruction, instructionIndex) => (
                                <li key={instructionIndex}>{instruction}</li>
                              ))}
                            </ol>
                          ) : (
                            <p>분리된 조리 순서가 없습니다.</p>
                          )}
                        </details>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {editingRecipeId && editingRecipe && (
        <div
          className="modal-backdrop"
          onClick={cancelEditingRecipe}
          role="presentation"
        >
          <section
            className="edit-modal"
            role="dialog"
            aria-modal="true"
            aria-label="레시피 편집"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-title-row">
              <div className="field modal-title-field">
                <label htmlFor="edit-title">레시피 제목</label>
                <input
                  ref={editTitleInputRef}
                  id="edit-title"
                  type="text"
                  value={editingRecipe.title}
                  onChange={(event) =>
                    updateEditingRecipeField("title", event.target.value)
                  }
                  className={editingTitleError ? "input-invalid" : ""}
                  aria-invalid={editingTitleError ? "true" : "false"}
                  placeholder="레시피 제목"
                />

                {editingTitleError && (
                  <p className="field-error-text">{editingTitleError}</p>
                )}
              </div>

              <div className="modal-title-actions">
                <button
                  type="button"
                  className="edit-button"
                  onClick={cancelEditingRecipe}
                >
                  취소
                </button>

                <button
                  type="button"
                  className="edit-button"
                  onClick={() => handleUpdateRecipe(editingRecipeId)}
                  disabled={updatingRecipeId === editingRecipeId}
                >
                  {updatingRecipeId === editingRecipeId ? "저장 중" : "저장"}
                </button>
              </div>
            </div>

            <div className="modal-section">
              <div className="section-heading">
                <h3>재료</h3>

                <button
                  type="button"
                  className="ghost-button"
                  onClick={addEditingIngredient}
                >
                  재료 추가
                </button>
              </div>

              <div className="editable-block">
                {editingRecipe.ingredients.map((ingredient, index) => (
                  <div className="ingredient-edit-row" key={index}>
                    <button
                      type="button"
                      className={`tag-toggle-button${
                        isScalableIngredientGroup(
                          splitIngredientLabel(ingredient).group,
                        )
                          ? " tag-toggle-button-active"
                          : ""
                      }`}
                      onClick={() => toggleEditingIngredientTag(index, "양념")}
                    >
                      양념
                    </button>

                    <input
                      type="text"
                      value={ingredient}
                      onChange={(event) =>
                        handleEditingIngredientChange(index, event.target.value)
                      }
                    />

                    <div className="row-action-group">
                      <button
                        type="button"
                        className="ghost-button row-move-button"
                        onClick={() => moveEditingIngredient(index, -1)}
                        disabled={index === 0}
                        aria-label="재료 위로 이동"
                      >
                        ↑
                      </button>

                      <button
                        type="button"
                        className="ghost-button row-move-button"
                        onClick={() => moveEditingIngredient(index, 1)}
                        disabled={
                          index === editingRecipe.ingredients.length - 1
                        }
                        aria-label="재료 아래로 이동"
                      >
                        ↓
                      </button>

                      <button
                        type="button"
                        className="ghost-button ingredient-delete-button"
                        onClick={() => removeEditingIngredient(index)}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-section">
              <div className="section-heading">
                <h3>조리 순서</h3>

                <button
                  type="button"
                  className="ghost-button"
                  onClick={addEditingInstruction}
                >
                  단계 추가
                </button>
              </div>

              <div className="editable-block">
                {editingRecipe.instructions.map((instruction, index) => (
                  <div className="instruction-row" key={index}>
                    <strong>{index + 1}</strong>

                    <textarea
                      rows="3"
                      value={instruction}
                      onChange={(event) =>
                        handleEditingInstructionChange(index, event.target.value)
                      }
                    />

                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => removeEditingInstruction(index)}
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="edit-button"
                onClick={cancelEditingRecipe}
              >
                취소
              </button>

              <button
                type="button"
                className="edit-button"
                onClick={() => handleUpdateRecipe(editingRecipeId)}
                disabled={updatingRecipeId === editingRecipeId}
              >
                {updatingRecipeId === editingRecipeId ? "저장 중" : "저장"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default App;
