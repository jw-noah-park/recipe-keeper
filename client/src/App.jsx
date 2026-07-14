import { useEffect, useState } from "react";
import { parseRecipeText } from "./utils/parseRecipeText.js";
import "./App.css";

const API_URL =
  import.meta.env.VITE_API_URL?.trim() || "http://localhost:5001/api";

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

  const haystack = [
    recipe.title,
    ...(recipe.ingredients ?? []),
    ...(recipe.instructions ?? []),
  ]
    .join(" ")
    .toLowerCase();

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
  const [recipeScales, setRecipeScales] = useState({});

  const [hasParsed, setHasParsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingRecipeId, setUpdatingRecipeId] = useState(null);
  const [error, setError] = useState("");

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
  const filteredRecipes = recipes.filter((recipe) =>
    matchesRecipe(recipe, normalizedSearchQuery),
  );

  function getRecipeScale(recipeId) {
    return recipeScales[recipeId] ?? 1;
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
      return;
    }

    const parsedRecipe = parseRecipeText(rawText);

    setIngredients(parsedRecipe.ingredients);
    setInstructions(parsedRecipe.instructions);
    setHasParsed(true);
    setError("");
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
  }

  async function handleSaveRecipe() {
    if (!title.trim()) {
      setError("레시피 제목을 입력해 주세요.");
      return;
    }

    if (!rawText.trim()) {
      setError("레시피 원문이 없습니다.");
      return;
    }

    try {
      setSaving(true);
      setError("");

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

      resetForm();
    } catch (error) {
      setError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateRecipe(recipeId) {
    if (!editingRecipe.title.trim()) {
      setError("레시피 제목을 입력해 주세요.");
      return;
    }

    try {
      setUpdatingRecipeId(recipeId);
      setError("");

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

      cancelEditingRecipe();
    } catch (error) {
      setError(error.message);
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
                placeholder="제목, 재료, 조리 순서 검색"
              />
            </div>

            <p className="recipes-count">
              {loading ? "불러오는 중..." : `${filteredRecipes.length}개 표시 중`}
            </p>
          </div>
        </section>

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
              {isPastePanelOpen ? "🔼" : "🔽"}
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

        {hasParsed && (
          <section className="panel">
            <h2>정리 결과</h2>

            <div className="field">
              <label htmlFor="title">레시피 제목</label>

              <input
                id="title"
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="예: 막김치"
              />
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

                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => removeIngredient(index)}
                    >
                      삭제
                    </button>
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
              {filteredRecipes.map((recipe) => {
                const scale = getRecipeScale(recipe.id);

                return (
                  <article className="recipe-card" key={recipe.id}>
                    <div className="recipe-card-header">
                      <div className="recipe-card-title-block">
                        <h3>{recipe.title}</h3>

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
                      </div>
                    </div>

                    <div className="recipe-card-body">
                      <div className="recipe-section-header">
                        <h4>재료</h4>
                      </div>

                      {recipe.ingredients?.length > 0 ? (
                        <ul className="ingredient-list">
                          {recipe.ingredients.map((ingredient, index) => {
                            const scaledIngredient = scaleIngredientText(
                              ingredient,
                              scale,
                            );
                            const { group, text } =
                              splitIngredientLabel(scaledIngredient);

                            return (
                              <li key={index} className="ingredient-item">
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
                            {recipe.instructions.map((instruction, index) => (
                              <li key={index}>{instruction}</li>
                            ))}
                          </ol>
                        ) : (
                          <p>분리된 조리 순서가 없습니다.</p>
                        )}
                      </details>
                    </div>
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
                  id="edit-title"
                  type="text"
                  value={editingRecipe.title}
                  onChange={(event) =>
                    updateEditingRecipeField("title", event.target.value)
                  }
                  placeholder="레시피 제목"
                />
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

                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => removeEditingIngredient(index)}
                    >
                      삭제
                    </button>
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
