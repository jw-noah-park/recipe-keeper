const INGREDIENT_HEADING_PATTERN =
  /^(?:재료|재료 목록|준비물|ingredients?)\s*[:/-]?\s*$/i;

const INSTRUCTION_HEADING_PATTERN =
  /^(?:만드는 ?법|조리 ?순서|조리법|방법|instructions?|directions?|steps?)\s*[:/-]?\s*$/i;

const GROUP_KEYWORD_PATTERN =
  /(?:양념|양념장|다데기|다대기|소스|드레싱|토핑|고명|시럽|반죽|속재료|필링|마리네이드|육수|밑간|sauce|dressing|topping|marinade|filling|batter|syrup)/i;

const STEP_MARKER_PATTERN =
  /(?:^|\n)\s*(?:\d+[.)]|[①②③④⑤⑥⑦⑧⑨⑩]|step\s*\d+[.:)]?|단계\s*\d+[.:)]?)\s*/gi;

const FIRST_STEP_PATTERN =
  /(?:^|\n)\s*(?:\d+[.)]|①|step\s*1[.:)]?|단계\s*1[.:)]?)/i;

const COOKING_VERB_PATTERN =
  /(볶|끓|넣|섞|굽|데치|삶|썰|다지|재우|버무리|예열|가열|졸이|뒤집|올리브유를 두르|mix|stir|cook|bake|boil|fry|heat|preheat|combine|add)/i;

const QUANTITY_HINT_PATTERN =
  /(?:\d+(?:\.\d+)?(?:\/\d+)?|\d+\s+\d\/\d|[¼½¾⅓⅔⅛⅜⅝⅞]|한|두|세|네|반|약간|적당량|조금|소량)\s*(?:g|kg|mg|ml|l|cc|컵|공기|큰술|작은술|숟가락|스푼|국자|tsp|tbsp|ts|tb|개|장|줄|쪽|알|봉|팩|캔|줌|꼬집|인분|slice|slices|cup|cups|teaspoon|teaspoons|tablespoon|tablespoons|clove|cloves)?/i;

const TITLE_PREFIX_PATTERN =
  /^(?:레시피\s*제목|제목|요리명|메뉴명|recipe(?:\s*name)?|title)\s*[:：-]\s*(.+)$/i;

function normalizeText(text) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripListMarker(line) {
  return line
    .replace(/^(?:[-•*◦·]|(?:\d+[.)])|[①②③④⑤⑥⑦⑧⑨⑩])\s*/, "")
    .trim();
}

function stripInstructionHeading(text) {
  return text
    .replace(
      /^(?:만드는 ?법|조리 ?순서|조리법|방법|instructions?|directions?|steps?)\s*[:/-]?\s*/i,
      "",
    )
    .trim();
}

function normalizeGroupName(groupName) {
  return groupName
    .replace(/^[[(<]+/, "")
    .replace(/[\]>)]+$/, "")
    .replace(/\s*재료\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatIngredient(ingredient, groupName) {
  return groupName ? `[${groupName}] ${ingredient}` : ingredient;
}

function isInstructionHeading(line) {
  return INSTRUCTION_HEADING_PATTERN.test(line.trim());
}

function isIngredientHeading(line) {
  return INGREDIENT_HEADING_PATTERN.test(line.trim());
}

function looksLikeIngredientList(line) {
  const normalizedLine = stripListMarker(line).trim();

  if (!normalizedLine.includes(",")) {
    return false;
  }

  const items = normalizedLine
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (items.length < 2) {
    return false;
  }

  const quantityItemCount = items.filter((item) =>
    QUANTITY_HINT_PATTERN.test(item),
  ).length;

  return quantityItemCount >= 2 || items.length >= 4;
}

function isLikelyInstructionLine(line) {
  const normalizedLine = line.trim();

  if (!normalizedLine) {
    return false;
  }

  if (
    /^(?:\d+[.)]|[①②③④⑤⑥⑦⑧⑨⑩]|step\s*\d+[.:)]?|단계\s*\d+[.:)]?)/i.test(
      normalizedLine,
    )
  ) {
    return true;
  }

  if (isInstructionHeading(normalizedLine)) {
    return true;
  }

  if (looksLikeIngredientList(normalizedLine)) {
    return false;
  }

  return COOKING_VERB_PATTERN.test(normalizedLine);
}

function isLikelyIngredientLine(line) {
  const normalizedLine = stripListMarker(line);

  if (!normalizedLine) {
    return false;
  }

  if (isInstructionHeading(normalizedLine) || isLikelyInstructionLine(normalizedLine)) {
    return false;
  }

  if (/^\d+(?:\.\d+)?\s*(?:인분|servings?)$/i.test(normalizedLine)) {
    return false;
  }

  if (GROUP_KEYWORD_PATTERN.test(normalizedLine) && normalizedLine.length <= 18) {
    return true;
  }

  if (QUANTITY_HINT_PATTERN.test(normalizedLine)) {
    return true;
  }

  if (
    /[,]/.test(normalizedLine) &&
    normalizedLine.length <= 80 &&
    !/[.!?]$/.test(normalizedLine)
  ) {
    return true;
  }

  if (
    /^[A-Za-z가-힣][A-Za-z가-힣0-9\s()/-]{0,30}$/.test(normalizedLine) &&
    normalizedLine.length <= 30
  ) {
    return true;
  }

  return false;
}

function extractInlineGroup(line) {
  const inlineGroupMatch = line.match(
    /^(.{1,20}?)\s*[:：-]\s*(.+)$/i,
  );

  if (!inlineGroupMatch) {
    return null;
  }

  const groupName = normalizeGroupName(inlineGroupMatch[1]);
  const rest = inlineGroupMatch[2].trim();

  if (!groupName || !rest || !GROUP_KEYWORD_PATTERN.test(groupName)) {
    return null;
  }

  return {
    groupName,
    rest,
  };
}

function extractStandaloneGroup(line) {
  const groupName = normalizeGroupName(line);

  if (!groupName || !GROUP_KEYWORD_PATTERN.test(groupName)) {
    return "";
  }

  if (groupName.length > 20) {
    return "";
  }

  return groupName;
}

function splitIngredientItems(line) {
  const normalizedLine = stripListMarker(line)
    .replace(/^재료\s*[:/-]?\s*/i, "")
    .trim();

  if (!normalizedLine) {
    return [];
  }

  const separators = /(?:,\s*|\s+\/\s+|\s+[·•ㆍ]\s+)/;
  const hasMultipleItems = separators.test(normalizedLine);

  if (!hasMultipleItems) {
    return [normalizedLine];
  }

  return normalizedLine
    .split(separators)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeIngredients(ingredients) {
  const seen = new Set();

  return ingredients.filter((ingredient) => {
    const key = ingredient.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function extractIngredients(lines) {
  const ingredients = [];
  let inIngredientSection = false;
  let currentGroup = "";
  let sawIngredientSignal = false;

  for (const line of lines) {
    if (isInstructionHeading(line)) {
      inIngredientSection = false;
      currentGroup = "";
      continue;
    }

    if (isIngredientHeading(line)) {
      inIngredientSection = true;
      currentGroup = "";
      sawIngredientSignal = true;
      continue;
    }

    const inlineGroup = extractInlineGroup(line);

    if (inlineGroup) {
      inIngredientSection = true;
      currentGroup = inlineGroup.groupName;
      sawIngredientSignal = true;

      const items = splitIngredientItems(inlineGroup.rest);

      items.forEach((item) =>
        ingredients.push(formatIngredient(item, currentGroup)),
      );

      continue;
    }

    const standaloneGroup = extractStandaloneGroup(line);

    if (standaloneGroup && (inIngredientSection || !sawIngredientSignal)) {
      inIngredientSection = true;
      currentGroup = standaloneGroup;
      sawIngredientSignal = true;
      continue;
    }

    const ingredientLike = isLikelyIngredientLine(line);
    const instructionLike = isLikelyInstructionLine(line);

    if (inIngredientSection) {
      if (instructionLike && !ingredientLike) {
        inIngredientSection = false;
        currentGroup = "";
        continue;
      }

      const items = splitIngredientItems(line);

      items.forEach((item) =>
        ingredients.push(formatIngredient(item, currentGroup)),
      );

      continue;
    }

    if (ingredientLike && !instructionLike) {
      sawIngredientSignal = true;

      const items = splitIngredientItems(line);

      items.forEach((item) =>
        ingredients.push(formatIngredient(item, currentGroup)),
      );
    }
  }

  return dedupeIngredients(ingredients);
}

function extractTitle(lines) {
  for (const line of lines.slice(0, 6)) {
    const normalizedLine = stripListMarker(line).trim();

    if (!normalizedLine) {
      continue;
    }

    const titleMatch = normalizedLine.match(TITLE_PREFIX_PATTERN);

    if (titleMatch?.[1]?.trim()) {
      return titleMatch[1].trim();
    }

    if (
      isIngredientHeading(normalizedLine) ||
      isInstructionHeading(normalizedLine) ||
      /^\d+(?:\.\d+)?\s*(?:인분|servings?)$/i.test(normalizedLine)
    ) {
      continue;
    }

    if (
      !isLikelyIngredientLine(normalizedLine) &&
      !isLikelyInstructionLine(normalizedLine) &&
      normalizedLine.length <= 60
    ) {
      return normalizedLine;
    }
  }

  return "";
}

function findInstructionSection(text) {
  const headingMatch = text.match(
    /(?:^|\n)\s*(?:만드는 ?법|조리 ?순서|조리법|방법|instructions?|directions?|steps?)\s*[:/-]?\s*/i,
  );

  const stepMatch = text.match(FIRST_STEP_PATTERN);

  if (!headingMatch && !stepMatch) {
    return "";
  }

  if (headingMatch && stepMatch) {
    return text.slice(Math.min(headingMatch.index, stepMatch.index)).trim();
  }

  return text.slice((headingMatch || stepMatch).index).trim();
}

function findInstructionSectionFromLines(lines) {
  let inIngredientSection = false;
  let sawIngredientSignal = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (isInstructionHeading(line)) {
      return lines.slice(index).join("\n").trim();
    }

    if (isIngredientHeading(line)) {
      inIngredientSection = true;
      sawIngredientSignal = true;
      continue;
    }

    const inlineGroup = extractInlineGroup(line);

    if (inlineGroup) {
      inIngredientSection = true;
      sawIngredientSignal = true;
      continue;
    }

    const standaloneGroup = extractStandaloneGroup(line);

    if (standaloneGroup) {
      inIngredientSection = true;
      sawIngredientSignal = true;
      continue;
    }

    const ingredientLike = isLikelyIngredientLine(line);
    const instructionLike = isLikelyInstructionLine(line);

    if (inIngredientSection) {
      if (instructionLike && !ingredientLike) {
        return lines.slice(index).join("\n").trim();
      }

      if (ingredientLike) {
        continue;
      }

      inIngredientSection = false;
    }

    if (ingredientLike && !instructionLike) {
      sawIngredientSignal = true;
      continue;
    }

    if (sawIngredientSignal && instructionLike) {
      return lines.slice(index).join("\n").trim();
    }
  }

  return "";
}

function splitInstructions(text) {
  const cleanedText = stripInstructionHeading(text);

  if (!cleanedText) {
    return [];
  }

  STEP_MARKER_PATTERN.lastIndex = 0;

  if (STEP_MARKER_PATTERN.test(cleanedText)) {
    STEP_MARKER_PATTERN.lastIndex = 0;

    return cleanedText
      .split(STEP_MARKER_PATTERN)
      .map((step) => step.trim())
      .filter(Boolean);
  }

  return cleanedText
    .split("\n")
    .map((line) => stripListMarker(line))
    .filter((line) => line && isLikelyInstructionLine(line));
}

export function parseRecipeText(rawText) {
  const normalizedText = normalizeText(rawText);

  if (!normalizedText) {
    return {
      title: "",
      ingredients: [],
      instructions: [],
      formattedText: "",
    };
  }

  const lines = splitLines(normalizedText);
  const ingredients = extractIngredients(lines);
  const instructionSection =
    findInstructionSection(normalizedText) ||
    findInstructionSectionFromLines(lines);

  return {
    title: extractTitle(lines),
    ingredients,
    instructions: splitInstructions(instructionSection),
    formattedText: normalizedText,
  };
}
