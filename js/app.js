const checkButton = document.getElementById("checkButton");
const fixButton = document.getElementById("fixButton");
const zipFile = document.getElementById("zipFile");
const report = document.getElementById("report");
const mainDocumentArea = document.getElementById("mainDocumentArea");
const mainDocumentSelect = document.getElementById("mainDocumentSelect");

let currentProjectFile = null;
let currentRootDocuments = [];
let currentLatexFiles = [];
let currentDependencyGraph = null;
let currentAnalysisData = null;


/* =========================================================
   PACKAGE COMPATIBILITY RULES
   ========================================================= */

const PACKAGE_COMPATIBILITY_RULES = {
  systeme: {
    status: "currently-incompatible",
    note: "No LuaMML support.",
    autoRemoveIfUnused: true,
    usagePatterns: [
      /\\(?:systeme|setsysteme|sys[A-Za-z@]+)\b/g
    ]
  },

  enumerate: {
    status: "currently-incompatible",
    note: "Legacy enumerate package; list migration may be required.",
    autoRemoveIfUnused: false,
    usagePatterns: []
  },

  esvect: {
    status: "currently-incompatible",
    note: "No LuaMML support.",
    autoRemoveIfUnused: false,
    usagePatterns: [
      /\\vv\b/g
    ]
  }
};


/* =========================================================
   MAIN DOCUMENT SELECTOR
   ========================================================= */

mainDocumentSelect.addEventListener("change", () => {
  if (
    !mainDocumentSelect.value ||
    currentLatexFiles.length === 0
  ) {
    currentDependencyGraph = null;
    return;
  }

  currentDependencyGraph = buildDependencyGraph(
    mainDocumentSelect.value,
    currentLatexFiles
  );

  if (currentAnalysisData) {
    renderReport(currentAnalysisData);
  }
});


/* =========================================================
   CHECK PROJECT
   ========================================================= */

checkButton.addEventListener("click", async () => {
  if (!zipFile.files.length) {
    showMessage("Please choose a ZIP file first.");
    return;
  }

  const file = zipFile.files[0];

  currentProjectFile = file;
  currentRootDocuments = [];
  currentLatexFiles = [];
  currentDependencyGraph = null;
  currentAnalysisData = null;

  fixButton.disabled = true;
  mainDocumentArea.hidden = true;
  mainDocumentSelect.innerHTML = "";

  showMessage(`Reading ${file.name}...`);

  try {
    const zip = await JSZip.loadAsync(file);
    const latexFiles = [];

    for (
      const [filename, zipEntry]
      of Object.entries(zip.files)
    ) {
      if (zipEntry.dir) {
        continue;
      }

      if (
        filename.startsWith("__MACOSX/") ||
        filename.endsWith(".DS_Store")
      ) {
        continue;
      }

      const lowerName = filename.toLowerCase();

      if (
        lowerName.endsWith(".tex") ||
        lowerName.endsWith(".sty") ||
        lowerName.endsWith(".cls")
      ) {
        const rawContent =
          await zipEntry.async("string");

        latexFiles.push({
          filename:
            normalizeProjectPath(filename),

          rawContent,

          content:
            stripLatexComments(rawContent)
        });
      }
    }

    currentLatexFiles = latexFiles;

    analyzeProject(
      file.name,
      latexFiles
    );

  } catch (error) {
    console.error(error);

    showMessage(
      "The ZIP file could not be read. Please make sure it is a valid LaTeX or Overleaf project ZIP."
    );
  }
});


/* =========================================================
   PROJECT ANALYSIS
   ========================================================= */

function analyzeProject(projectName, files) {
  if (files.length === 0) {
    showMessage(
      "No .tex, .sty, or .cls files were found in this ZIP."
    );

    return;
  }

  const rootDocuments =
    files.filter(file =>
      /\\documentclass(?:\s*\[[^\]]*\])?\s*\{/
        .test(file.content)
    );

  currentRootDocuments =
    rootDocuments.map(
      file => file.filename
    );

  updateMainDocumentSelector();

  const metadataFiles =
    files.filter(file =>
      file.content.includes(
        "\\DocumentMetadata"
      )
    );

  const mathMLFiles =
    files.filter(file =>
      /math\s*\/\s*setup\s*=\s*mathml-SE/i
        .test(file.content)
    );

  const luaMMLDisabledFiles =
    files.filter(file =>
      /math\s*\/\s*mathml\s*\/\s*luamml\s*\/\s*load\s*=\s*false/i
        .test(file.content)
    );

  const metadataResults =
    rootDocuments.map(
      root => inspectRootDocument(root)
    );

  currentAnalysisData = {
    projectName,
    files,
    rootDocuments,
    metadataFiles,
    mathMLFiles,
    luaMMLDisabledFiles,
    metadataResults
  };

  renderReport(
    currentAnalysisData
  );
}


function updateMainDocumentSelector() {
  mainDocumentSelect.innerHTML = "";

  if (currentRootDocuments.length === 0) {
    mainDocumentArea.hidden = true;
    fixButton.disabled = true;
    currentDependencyGraph = null;
    return;
  }

  currentRootDocuments.forEach(
    filename => {
      const option =
        document.createElement("option");

      option.value = filename;
      option.textContent = filename;

      mainDocumentSelect.appendChild(
        option
      );
    }
  );

  /*
   * Prefer a root-level main.tex.
   *
   * Only if there is no root-level main.tex
   * do we fall back to something such as
   * folder/main.tex.
   */

  let preferredMain =
    currentRootDocuments.find(
      filename =>
        normalizeProjectPath(filename)
          .toLowerCase() ===
        "main.tex"
    );

  if (!preferredMain) {
    preferredMain =
      currentRootDocuments.find(
        filename =>
          normalizeProjectPath(filename)
            .toLowerCase()
            .endsWith("/main.tex")
      );
  }

  if (preferredMain) {
    mainDocumentSelect.value =
      preferredMain;
  }

  mainDocumentArea.hidden = false;
  fixButton.disabled = false;

  currentDependencyGraph =
    buildDependencyGraph(
      mainDocumentSelect.value,
      currentLatexFiles
    );

  console.log(
    "Selected main document:",
    mainDocumentSelect.value
  );

  console.log(
    "Dependency graph:",
    currentDependencyGraph
  );
}


function inspectRootDocument(file) {
  const content = file.content;

  const documentClassIndex =
    content.search(
      /\\documentclass/
    );

  const metadataIndex =
    content.search(
      /\\DocumentMetadata/
    );

  let metadata = "";

  if (metadataIndex !== -1) {
    metadata =
      extractCommandArgument(
        content,
        metadataIndex,
        "\\DocumentMetadata"
      );
  }

  return {
    filename:
      file.filename,

    hasMetadata:
      metadataIndex !== -1,

    metadataBeforeDocumentClass:
      metadataIndex !== -1 &&
      documentClassIndex !== -1 &&
      metadataIndex <
        documentClassIndex,

    taggingOn:
      /tagging\s*=\s*on/i
        .test(metadata),

    ua2:
      /pdfstandard\s*=\s*ua-2/i
        .test(metadata),

    language:
      /lang\s*=\s*[a-z]{2}(?:-[A-Z]{2})?/i
        .test(metadata),

    pdf20:
      /pdfversion\s*=\s*2(?:\.0)?/i
        .test(metadata),

    mathMLSE:
      /math\s*\/\s*setup\s*=\s*mathml-SE/i
        .test(metadata)
  };
}


function extractCommandArgument(
  text,
  commandPosition,
  commandName
) {
  let position =
    commandPosition +
    commandName.length;

  while (
    position < text.length &&
    /\s/.test(text[position])
  ) {
    position++;
  }

  if (text[position] !== "{") {
    return "";
  }

  let depth = 0;
  let result = "";

  for (
    let i = position;
    i < text.length;
    i++
  ) {
    const char = text[i];

    if (char === "{") {
      depth++;

      if (depth > 1) {
        result += char;
      }

      continue;
    }

    if (char === "}") {
      depth--;

      if (depth === 0) {
        return result;
      }

      result += char;
      continue;
    }

    if (depth >= 1) {
      result += char;
    }
  }

  return result;
}


function stripLatexComments(text) {
  return text
    .split("\n")
    .map(line => {
      for (
        let i = 0;
        i < line.length;
        i++
      ) {
        if (line[i] !== "%") {
          continue;
        }

        let backslashes = 0;

        for (
          let j = i - 1;
          j >= 0 &&
          line[j] === "\\";
          j--
        ) {
          backslashes++;
        }

        if (
          backslashes % 2 === 0
        ) {
          return line.substring(
            0,
            i
          );
        }
      }

      return line;
    })
    .join("\n");
}


/* =========================================================
   DEPENDENCY SCANNER
   ========================================================= */

function normalizeProjectPath(path) {
  const parts = [];

  path
    .replace(/\\/g, "/")
    .split("/")
    .forEach(part => {
      if (
        !part ||
        part === "."
      ) {
        return;
      }

      if (part === "..") {
        if (parts.length > 0) {
          parts.pop();
        }

        return;
      }

      parts.push(part);
    });

  return parts.join("/");
}


function getDirectory(filename) {
  const normalized =
    normalizeProjectPath(filename);

  const slash =
    normalized.lastIndexOf("/");

  return slash === -1
    ? ""
    : normalized.slice(
        0,
        slash
      );
}


function joinProjectPath(
  directory,
  target
) {
  if (!directory) {
    return normalizeProjectPath(
      target
    );
  }

  return normalizeProjectPath(
    `${directory}/${target}`
  );
}


function looksDynamicReference(
  target
) {
  return (
    target.includes("\\") ||
    target.includes("#") ||
    target.includes("$")
  );
}


function extractDependencies(file) {
  const dependencies = [];
  const content = file.content;

  /*
   * \input
   * \include
   * \subfile
   */

  const texPattern =
    /\\(input|include|subfile)\s*\{([^{}]+)\}/g;

  let match;

  while (
    (
      match =
        texPattern.exec(content)
    ) !== null
  ) {
    dependencies.push({
      type:
        match[1],

      target:
        match[2].trim(),

      required:
        true
    });
  }

  /*
   * Local packages.
   */

  const packagePattern =
    /\\(?:usepackage|RequirePackage)(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g;

  while (
    (
      match =
        packagePattern.exec(content)
    ) !== null
  ) {
    match[1]
      .split(",")
      .map(
        name => name.trim()
      )
      .filter(Boolean)
      .forEach(name => {
        dependencies.push({
          type:
            "package",

          target:
            name,

          required:
            false
        });
      });
  }

  /*
   * Local document class.
   */

  const classPattern =
    /\\documentclass(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g;

  while (
    (
      match =
        classPattern.exec(content)
    ) !== null
  ) {
    dependencies.push({
      type:
        "class",

      target:
        match[1].trim(),

      required:
        false
    });
  }

  return dependencies;
}


function resolveDependency(
  fromFilename,
  dependency,
  fileMap
) {
  const target =
    dependency.target;

  if (
    looksDynamicReference(target)
  ) {
    return {
      status:
        "dynamic",

      target
    };
  }

  const directory =
    getDirectory(
      fromFilename
    );

  let candidates = [];

  if (
    dependency.type ===
      "input" ||
    dependency.type ===
      "include" ||
    dependency.type ===
      "subfile"
  ) {
    /*
     * Relative to current file.
     */

    candidates.push(
      joinProjectPath(
        directory,
        target
      )
    );

    /*
     * Relative to project root.
     */

    candidates.push(
      normalizeProjectPath(
        target
      )
    );

    if (
      !/\.[A-Za-z0-9]+$/
        .test(target)
    ) {
      candidates.push(
        joinProjectPath(
          directory,
          `${target}.tex`
        )
      );

      candidates.push(
        normalizeProjectPath(
          `${target}.tex`
        )
      );
    }
  }

  if (
    dependency.type ===
    "package"
  ) {
    const packageTarget =
      /\.sty$/i.test(target)
        ? target
        : `${target}.sty`;

    candidates.push(
      joinProjectPath(
        directory,
        packageTarget
      )
    );

    candidates.push(
      normalizeProjectPath(
        packageTarget
      )
    );
  }

  if (
    dependency.type ===
    "class"
  ) {
    const classTarget =
      /\.cls$/i.test(target)
        ? target
        : `${target}.cls`;

    candidates.push(
      joinProjectPath(
        directory,
        classTarget
      )
    );

    candidates.push(
      normalizeProjectPath(
        classTarget
      )
    );
  }

  candidates =
    [...new Set(candidates)];

  for (
    const candidate
    of candidates
  ) {
    if (
      fileMap.has(candidate)
    ) {
      return {
        status:
          "found",

        filename:
          candidate
      };
    }
  }

  if (
    dependency.required
  ) {
    return {
      status:
        "missing",

      target
    };
  }

  return {
    status:
      "external",

    target
  };
}


function buildDependencyGraph(
  rootFilename,
  files
) {
  const fileMap =
    new Map();

  files.forEach(file => {
    fileMap.set(
      normalizeProjectPath(
        file.filename
      ),
      file
    );
  });

  const root =
    normalizeProjectPath(
      rootFilename
    );

  const usedFiles =
    new Set();

  const edges = [];
  const missing = [];
  const dynamic = [];

  function visit(filename) {
    if (
      usedFiles.has(filename)
    ) {
      return;
    }

    const file =
      fileMap.get(filename);

    if (!file) {
      return;
    }

    usedFiles.add(filename);

    const dependencies =
      extractDependencies(file);

    dependencies.forEach(
      dependency => {
        const resolution =
          resolveDependency(
            filename,
            dependency,
            fileMap
          );

        if (
          resolution.status ===
          "found"
        ) {
          edges.push({
            from:
              filename,

            to:
              resolution.filename,

            type:
              dependency.type
          });

          visit(
            resolution.filename
          );
        }

        if (
          resolution.status ===
          "missing"
        ) {
          missing.push({
            from:
              filename,

            target:
              dependency.target,

            type:
              dependency.type
          });
        }

        if (
          resolution.status ===
          "dynamic"
        ) {
          dynamic.push({
            from:
              filename,

            target:
              dependency.target,

            type:
              dependency.type
          });
        }
      }
    );
  }

  visit(root);

  return {
    root,
    usedFiles,
    edges,
    missing,
    dynamic
  };
}


/* =========================================================
   PROJECT SCOPE HELPERS
   ========================================================= */

function getScopedFiles(
  files,
  projectScope
) {
  if (!projectScope) {
    return [];
  }

  return files.filter(file =>
    projectScope.usedFiles.has(
      normalizeProjectPath(
        file.filename
      )
    )
  );
}


/* =========================================================
   PACKAGE COMPATIBILITY ANALYSIS
   ========================================================= */

function findPackageDeclarations(
  files,
  projectScope
) {
  const declarations = [];

  const scopedFiles =
    getScopedFiles(
      files,
      projectScope
    );

  const packagePattern =
    /\\(usepackage|RequirePackage)(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g;

  scopedFiles.forEach(file => {
    let match;

    packagePattern.lastIndex = 0;

    while (
      (
        match =
          packagePattern.exec(
            file.content
          )
      ) !== null
    ) {
      match[2]
        .split(",")
        .map(
          name => name.trim()
        )
        .filter(Boolean)
        .forEach(name => {
          declarations.push({
            filename:
              file.filename,

            command:
              match[1],

            packageName:
              name
          });
        });
    }
  });

  return declarations;
}


function isPackageLoaded(
  declarations,
  packageName
) {
  return declarations.some(
    item =>
      item.packageName
        .toLowerCase() ===
      packageName
        .toLowerCase()
  );
}


function countRegexMatches(
  text,
  pattern
) {
  const flags =
    pattern.flags.includes("g")
      ? pattern.flags
      : pattern.flags + "g";

  const regex =
    new RegExp(
      pattern.source,
      flags
    );

  let count = 0;
  let match;

  while (
    (
      match =
        regex.exec(text)
    ) !== null
  ) {
    count++;

    if (
      match[0].length === 0
    ) {
      regex.lastIndex++;
    }
  }

  return count;
}


function analyzePackageCompatibility(
  files,
  projectScope
) {
  if (!projectScope) {
    return [];
  }

  const declarations =
    findPackageDeclarations(
      files,
      projectScope
    );

  const scopedFiles =
    getScopedFiles(
      files,
      projectScope
    );

  const combinedContent =
    scopedFiles
      .map(
        file => file.content
      )
      .join("\n");

  const results = [];

  Object.entries(
    PACKAGE_COMPATIBILITY_RULES
  ).forEach(
    ([packageName, rule]) => {
      const loadedIn =
        declarations
          .filter(
            item =>
              item.packageName
                .toLowerCase() ===
              packageName
                .toLowerCase()
          )
          .map(
            item =>
              item.filename
          );

      if (
        loadedIn.length === 0
      ) {
        return;
      }

      let usageCount = 0;

      rule.usagePatterns.forEach(
        pattern => {
          usageCount +=
            countRegexMatches(
              combinedContent,
              pattern
            );
        }
      );

      const appearsUnused =
        rule.usagePatterns.length >
          0 &&
        usageCount === 0;

      results.push({
        packageName,
        status:
          rule.status,

        note:
          rule.note,

        loadedIn:
          [...new Set(loadedIn)],

        usageCount,

        appearsUnused,

        autoRemove:
          Boolean(
            rule.autoRemoveIfUnused
          ) &&
          appearsUnused
      });
    }
  );

  return results;
}


function removePackageFromSource(
  source,
  packageName
) {
  const changes = [];

  const packagePattern =
    /\\(usepackage|RequirePackage)(\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g;

  source =
    source.replace(
      packagePattern,

      (
        fullMatch,
        command,
        options = "",
        packageList
      ) => {
        const packages =
          packageList
            .split(",")
            .map(
              name =>
                name.trim()
            )
            .filter(Boolean);

        const hasTarget =
          packages.some(
            name =>
              name
                .toLowerCase() ===
              packageName
                .toLowerCase()
          );

        if (!hasTarget) {
          return fullMatch;
        }

        const remaining =
          packages.filter(
            name =>
              name
                .toLowerCase() !==
              packageName
                .toLowerCase()
          );

        changes.push(
          `Removed package ${packageName}.`
        );

        if (
          remaining.length === 0
        ) {
          return "";
        }

        return (
          `\\${command}` +
          `${options || ""}` +
          `{${remaining.join(",")}}`
        );
      }
    );

  return {
    source,
    changes
  };
}


/* =========================================================
   PROTECTED SOURCE REGIONS
   ========================================================= */

/*
 * The source modernization rules must never rewrite literal
 * examples, code listings, comments, etc.
 *
 * These helpers locate regions that should remain untouched.
 */

function mergeRanges(ranges) {
  if (
    ranges.length === 0
  ) {
    return [];
  }

  const sorted =
    [...ranges].sort(
      (a, b) =>
        a.start - b.start
    );

  const merged = [
    {
      start:
        sorted[0].start,

      end:
        sorted[0].end
    }
  ];

  for (
    let i = 1;
    i < sorted.length;
    i++
  ) {
    const current =
      sorted[i];

    const previous =
      merged[
        merged.length - 1
      ];

    if (
      current.start <=
      previous.end
    ) {
      previous.end =
        Math.max(
          previous.end,
          current.end
        );
    } else {
      merged.push({
        start:
          current.start,

        end:
          current.end
      });
    }
  }

  return merged;
}


function indexInsideRanges(
  index,
  ranges
) {
  return ranges.some(
    range =>
      index >= range.start &&
      index < range.end
  );
}


function isIndexInLineComment(
  source,
  index
) {
  let lineStart =
    source.lastIndexOf(
      "\n",
      index - 1
    );

  if (
    lineStart === -1
  ) {
    lineStart = 0;
  } else {
    lineStart++;
  }

  for (
    let i = lineStart;
    i < index;
    i++
  ) {
    if (
      source[i] === "%" &&
      !isCharacterEscaped(
        source,
        i
      )
    ) {
      return true;
    }
  }

  return false;
}


function getProtectedRanges(
  source
) {
  const ranges = [];

  /*
   * Literal/code environments.
   */

  const protectedEnvironmentPattern =
    /\\begin\s*\{(verbatim\*?|Verbatim|BVerbatim|LVerbatim|lstlisting|minted|comment|filecontents\*?|alltt|luacode\*?|pycode)\}[\s\S]*?\\end\s*\{\1\}/g;

  let match;

  while (
    (
      match =
        protectedEnvironmentPattern
          .exec(source)
    ) !== null
  ) {
    if (
      isIndexInLineComment(
        source,
        match.index
      )
    ) {
      continue;
    }

    ranges.push({
      start:
        match.index,

      end:
        match.index +
        match[0].length
    });
  }

  /*
   * Inline \verb and \verb*.
   */

  const verbPattern =
    /\\verb\*?/g;

  while (
    (
      match =
        verbPattern.exec(source)
    ) !== null
  ) {
    const start =
      match.index;

    if (
      indexInsideRanges(
        start,
        ranges
      ) ||
      isIndexInLineComment(
        source,
        start
      )
    ) {
      continue;
    }

    const delimiterPosition =
      start +
      match[0].length;

    if (
      delimiterPosition >=
      source.length
    ) {
      continue;
    }

    const delimiter =
      source[
        delimiterPosition
      ];

    if (
      /\s/.test(delimiter)
    ) {
      continue;
    }

    let end =
      delimiterPosition + 1;

    while (
      end < source.length &&
      source[end] !==
        delimiter &&
      source[end] !== "\n"
    ) {
      end++;
    }

    if (
      end < source.length &&
      source[end] ===
        delimiter
    ) {
      ranges.push({
        start,
        end:
          end + 1
      });
    }
  }

  /*
   * Comments.
   */

  let lineStart = 0;

  while (
    lineStart <
    source.length
  ) {
    let lineEnd =
      source.indexOf(
        "\n",
        lineStart
      );

    if (
      lineEnd === -1
    ) {
      lineEnd =
        source.length;
    }

    for (
      let i = lineStart;
      i < lineEnd;
      i++
    ) {
      if (
        indexInsideRanges(
          i,
          ranges
        )
      ) {
        continue;
      }

      if (
        source[i] === "%" &&
        !isCharacterEscaped(
          source,
          i
        )
      ) {
        ranges.push({
          start:
            i,

          end:
            lineEnd
        });

        break;
      }
    }

    lineStart =
      lineEnd + 1;
  }

  return mergeRanges(
    ranges
  );
}


function transformOutsideProtectedRanges(
  source,
  transformer
) {
  const protectedRanges =
    getProtectedRanges(source);

  if (
    protectedRanges.length ===
    0
  ) {
    return transformer(source);
  }

  let output = "";
  let cursor = 0;

  protectedRanges.forEach(
    range => {
      if (
        cursor < range.start
      ) {
        output += transformer(
          source.slice(
            cursor,
            range.start
          )
        );
      }

      output +=
        source.slice(
          range.start,
          range.end
        );

      cursor =
        range.end;
    }
  );

  if (
    cursor < source.length
  ) {
    output += transformer(
      source.slice(cursor)
    );
  }

  return output;
}


/* =========================================================
   DISPLAY MATH MODERNIZATION
   ========================================================= */

/*
 * Convert:
 *
 *   $$ ... $$
 *
 * to:
 *
 *   \[ ... \]
 *
 * but only outside protected/literal regions.
 */

function convertDoubleDollarDisplays(
  source
) {
  let convertedCount = 0;
  let unmatchedDelimiterCount = 0;

  const transformed =
    transformOutsideProtectedRanges(
      source,

      segment => {
        let result = "";
        let cursor = 0;
        let openPosition = null;

        for (
          let i = 0;
          i <
            segment.length - 1;
          i++
        ) {
          if (
            segment[i] !== "$" ||
            segment[i + 1] !== "$"
          ) {
            continue;
          }

          if (
            isCharacterEscaped(
              segment,
              i
            )
          ) {
            continue;
          }

          if (
            openPosition === null
          ) {
            openPosition = i;
            i++;
            continue;
          }

          result +=
            segment.slice(
              cursor,
              openPosition
            );

          result += "\\[";

          result +=
            segment.slice(
              openPosition + 2,
              i
            );

          result += "\\]";

          cursor = i + 2;

          convertedCount++;

          openPosition = null;

          i++;
        }

        if (
          openPosition !== null
        ) {
          unmatchedDelimiterCount++;
        }

        result +=
          segment.slice(cursor);

        return result;
      }
    );

  const changes = [];

  if (
    convertedCount > 0
  ) {
    changes.push(
      `Converted ${convertedCount} plain-TeX $$...$$ display math occurrence(s) to \\[...\\].`
    );
  }

  return {
    source:
      transformed,

    convertedCount,

    unmatchedDelimiterCount,

    changes
  };
}


/* =========================================================
   LEGACY ENUMERATE MODERNIZATION
   ========================================================= */

const MODERN_ENUMITEM_KEY_ONLY_OPTIONS =
  new Set([
    "resume",
    "resume*",
    "nosep",
    "noitemsep",
    "wide",
    "inline"
  ]);


function bracesWrapEntireString(
  text
) {
  const trimmed =
    text.trim();

  if (
    !trimmed.startsWith("{") ||
    !trimmed.endsWith("}")
  ) {
    return false;
  }

  let depth = 0;

  for (
    let i = 0;
    i < trimmed.length;
    i++
  ) {
    const char =
      trimmed[i];

    if (
      char === "{" &&
      !isCharacterEscaped(
        trimmed,
        i
      )
    ) {
      depth++;
    }

    if (
      char === "}" &&
      !isCharacterEscaped(
        trimmed,
        i
      )
    ) {
      depth--;

      if (
        depth === 0 &&
        i <
          trimmed.length - 1
      ) {
        return false;
      }
    }
  }

  return depth === 0;
}


function stripOuterBraces(
  text
) {
  let result =
    text.trim();

  while (
    bracesWrapEntireString(
      result
    )
  ) {
    result =
      result
        .slice(1, -1)
        .trim();
  }

  return result;
}


function isModernEnumitemOption(
  option
) {
  const trimmed =
    option.trim();

  if (!trimmed) {
    return true;
  }

  /*
   * Key/value enumitem syntax.
   */

  if (
    trimmed.includes("=")
  ) {
    return true;
  }

  /*
   * A few common enumitem keys
   * do not require an "=".
   */

  const parts =
    splitTopLevelCommaList(
      trimmed
    )
      .map(
        item =>
          item.trim()
      )
      .filter(Boolean);

  if (
    parts.length > 0 &&
    parts.every(
      part =>
        MODERN_ENUMITEM_KEY_ONLY_OPTIONS
          .has(part)
    )
  ) {
    return true;
  }

  return false;
}


function convertLegacyEnumerateOption(
  option
) {
  let text =
    option.trim();

  if (
    !text ||
    isModernEnumitemOption(
      text
    )
  ) {
    return null;
  }

  text =
    stripOuterBraces(text);

  let bold = false;

  /*
   * Old style:
   *
   * {\bf (a)}
   * {\bf 1.}
   */

  let boldMatch =
    text.match(
      /^\\bf(?:series)?\s+([\s\S]+)$/
    );

  if (!boldMatch) {
    boldMatch =
      text.match(
        /^\\bf(?:series)?\s*\{([\s\S]+)\}$/
      );
  }

  if (boldMatch) {
    bold = true;

    text =
      stripOuterBraces(
        boldMatch[1]
      );
  }

  const counterMap = {
    a: "\\alph*",
    A: "\\Alph*",
    "1": "\\arabic*",
    i: "\\roman*",
    I: "\\Roman*"
  };

  let label = null;

  /*
   * (a), (A), (1), (i), (I)
   */

  let match =
    text.match(
      /^\(([aA1iI])\)$/
    );

  if (match) {
    label =
      `(${counterMap[match[1]]})`;
  }

  /*
   * a), A), 1), i), I)
   */

  if (!label) {
    match =
      text.match(
        /^([aA1iI])\)$/
      );

    if (match) {
      label =
        `${counterMap[match[1]]})`;
    }
  }

  /*
   * a., A., 1., i., I.
   */

  if (!label) {
    match =
      text.match(
        /^([aA1iI])\.$/
      );

    if (match) {
      label =
        `${counterMap[match[1]]}.`;
    }
  }

  /*
   * V1.
   */

  if (!label) {
    match =
      text.match(
        /^V1\.$/
      );

    if (match) {
      label =
        "V\\arabic*.";
    }
  }

  /*
   * C1.
   */

  if (!label) {
    match =
      text.match(
        /^C1\.$/
      );

    if (match) {
      label =
        "C\\arabic*.";
    }
  }

  /*
   * \thesection.1.
   */

  if (!label) {
    match =
      text.match(
        /^\\thesection\.1\.$/
      );

    if (match) {
      label =
        "\\thesection.\\arabic*.";
    }
  }

  if (!label) {
    return null;
  }

  if (bold) {
    return (
      "label={\\textbf{" +
      label +
      "}}"
    );
  }

  return `label=${label}`;
}


function migrateLegacyEnumerateSyntax(
  source
) {
  let convertedCount = 0;
  let modernOptionCount = 0;
  let reviewCount = 0;

  const reviewOptions = [];

  const transformed =
    transformOutsideProtectedRanges(
      source,

      segment => {
        const pattern =
          /\\begin\s*\{enumerate\}\s*\[([^\]]*)\]/g;

        return segment.replace(
          pattern,

          (
            fullMatch,
            option
          ) => {
            const trimmedOption =
              option.trim();

            if (
              isModernEnumitemOption(
                trimmedOption
              )
            ) {
              modernOptionCount++;

              return fullMatch;
            }

            const converted =
              convertLegacyEnumerateOption(
                trimmedOption
              );

            if (!converted) {
              reviewCount++;

              if (
                !reviewOptions
                  .includes(
                    trimmedOption
                  )
              ) {
                reviewOptions.push(
                  trimmedOption
                );
              }

              return fullMatch;
            }

            convertedCount++;

            const openBracket =
              fullMatch.indexOf("[");

            const closeBracket =
              fullMatch.lastIndexOf("]");

            return (
              fullMatch.slice(
                0,
                openBracket + 1
              ) +
              converted +
              fullMatch.slice(
                closeBracket
              )
            );
          }
        );
      }
    );

  const changes = [];

  if (
    convertedCount > 0
  ) {
    changes.push(
      `Converted ${convertedCount} legacy enumerate option(s) to enumitem label syntax.`
    );
  }

  return {
    source:
      transformed,

    convertedCount,

    modernOptionCount,

    reviewCount,

    reviewOptions,

    changes
  };
}


/* =========================================================
   ENSURE ENUMITEM PACKAGE
   ========================================================= */

function ensurePackageInMainDocument(
  source,
  packageName
) {
  const changes = [];

  const alreadyLoadedPattern =
    new RegExp(
      "\\\\(?:usepackage|RequirePackage)" +
      "(?:\\s*\\[[^\\]]*\\])?" +
      "\\s*\\{[^{}]*\\b" +
      packageName.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      ) +
      "\\b[^{}]*\\}",
      "i"
    );

  if (
    alreadyLoadedPattern.test(source)
  ) {
    return {
      source,
      changes
    };
  }

  const documentClassPattern =
    /\\documentclass(?:\s*\[[^\]]*\])?\s*\{[^{}]+\}/;

  const match =
    source.match(
      documentClassPattern
    );

  if (!match) {
    return {
      source,
      changes
    };
  }

  const insertionPosition =
    match.index +
    match[0].length;

  source =
    source.slice(
      0,
      insertionPosition
    ) +
    `\n\\usepackage{${packageName}}` +
    source.slice(
      insertionPosition
    );

  changes.push(
    `Added \\usepackage{${packageName}}.`
  );

  return {
    source,
    changes
  };
}


/* =========================================================
   SOURCE MODERNIZATION ANALYSIS
   ========================================================= */

function analyzeSourceModernization(
  files,
  projectScope
) {
  const scopedFiles =
    getScopedFiles(
      files,
      projectScope
    );

  const declarations =
    findPackageDeclarations(
      files,
      projectScope
    );

  const enumeratePackageLoaded =
    isPackageLoaded(
      declarations,
      "enumerate"
    );

  const enumitemPackageLoaded =
    isPackageLoaded(
      declarations,
      "enumitem"
    );

  let displayMathCount = 0;
  let unmatchedDisplayMathCount = 0;

  let enumerateConvertedCount = 0;
  let enumerateModernCount = 0;
  let enumerateReviewCount = 0;

  const enumerateReviewOptions =
    [];

  const perFile = [];

  scopedFiles.forEach(file => {
    /*
     * For now we only automatically modernize
     * document source files, not .sty or .cls.
     */

    if (
      !file.filename
        .toLowerCase()
        .endsWith(".tex")
    ) {
      return;
    }

    const displayResult =
      convertDoubleDollarDisplays(
        file.rawContent
      );

    const enumerateResult =
      migrateLegacyEnumerateSyntax(
        file.rawContent
      );

    displayMathCount +=
      displayResult.convertedCount;

    unmatchedDisplayMathCount +=
      displayResult
        .unmatchedDelimiterCount;

    enumerateConvertedCount +=
      enumerateResult
        .convertedCount;

    enumerateModernCount +=
      enumerateResult
        .modernOptionCount;

    enumerateReviewCount +=
      enumerateResult
        .reviewCount;

    enumerateResult
      .reviewOptions
      .forEach(option => {
        if (
          !enumerateReviewOptions
            .includes(option)
        ) {
          enumerateReviewOptions
            .push(option);
        }
      });

    if (
      displayResult.convertedCount >
        0 ||
      displayResult
        .unmatchedDelimiterCount >
        0 ||
      enumerateResult
        .convertedCount >
        0 ||
      enumerateResult
        .reviewCount >
        0
    ) {
      perFile.push({
        filename:
          file.filename,

        displayMathCount:
          displayResult
            .convertedCount,

        unmatchedDisplayMathCount:
          displayResult
            .unmatchedDelimiterCount,

        enumerateConvertedCount:
          enumerateResult
            .convertedCount,

        enumerateReviewCount:
          enumerateResult
            .reviewCount
      });
    }
  });

  /*
   * If the old enumerate package is loaded and
   * there are unknown/unresolved legacy options,
   * do not automatically migrate any of them.
   *
   * This prevents ending up with enumerate and
   * enumitem fighting over list syntax.
   */

  const canApplyEnumerateMigration =
    enumerateConvertedCount > 0 &&
    !(
      enumeratePackageLoaded &&
      enumerateReviewCount > 0
    );

  const canRemoveLegacyEnumerate =
    enumeratePackageLoaded &&
    canApplyEnumerateMigration &&
    enumerateReviewCount === 0;

  return {
    displayMathCount,
    unmatchedDisplayMathCount,

    enumerateConvertedCount,
    enumerateModernCount,
    enumerateReviewCount,
    enumerateReviewOptions,

    enumeratePackageLoaded,
    enumitemPackageLoaded,

    canApplyEnumerateMigration,
    canRemoveLegacyEnumerate,

    perFile
  };
}


/* =========================================================
   REPORT
   ========================================================= */

function renderReport(data) {
  report.innerHTML = "";

  const title =
    document.createElement("h3");

  title.textContent =
    `Project: ${data.projectName}`;

  report.appendChild(title);

  const summary =
    document.createElement("p");

  summary.textContent =
    `Analyzed ${data.files.length} LaTeX project file(s).`;

  report.appendChild(summary);


  /* ---------------------------------------------------------
     MAIN DOCUMENTS
     --------------------------------------------------------- */

  addSectionHeading(
    "Main document detection"
  );

  if (
    data.rootDocuments.length ===
    0
  ) {
    addResult(
      "warning",
      "No file containing \\documentclass was found."
    );
  } else {
    addResult(
      "pass",
      `${data.rootDocuments.length} candidate main document(s) found.`
    );

    data.rootDocuments.forEach(
      file => {
        addDetail(
          file.filename
        );
      }
    );
  }


  /* ---------------------------------------------------------
     SELECTED PROJECT SCOPE
     --------------------------------------------------------- */

  addSectionHeading(
    "Selected project scope"
  );

  if (
    !currentDependencyGraph
  ) {
    addResult(
      "warning",
      "No main document is currently selected."
    );
  } else {
    addResult(
      "pass",
      `Selected main document: ${currentDependencyGraph.root}`
    );

    addResult(
      "pass",
      `${currentDependencyGraph.usedFiles.size} project file(s) are used by the selected document.`
    );

    if (
      currentDependencyGraph
        .missing.length === 0
    ) {
      addResult(
        "pass",
        "No missing input/include/subfile files were detected."
      );
    } else {
      addResult(
        "warning",
        `${currentDependencyGraph.missing.length} referenced file(s) could not be found.`
      );

      currentDependencyGraph
        .missing
        .forEach(item => {
          addDetail(
            `${item.from} → ${item.target}`
          );
        });
    }

    if (
      currentDependencyGraph
        .dynamic.length > 0
    ) {
      addResult(
        "warning",
        `${currentDependencyGraph.dynamic.length} dynamic file reference(s) require manual review.`
      );

      currentDependencyGraph
        .dynamic
        .forEach(item => {
          addDetail(
            `${item.from} → ${item.target}`
          );
        });
    }
  }


  /* ---------------------------------------------------------
     DOCUMENT METADATA
     --------------------------------------------------------- */

  addSectionHeading(
    "Document metadata"
  );

  const selectedMain =
    currentDependencyGraph
      ? currentDependencyGraph.root
      : mainDocumentSelect.value;

  const selectedMetadataResult =
    data.metadataResults.find(
      result =>
        normalizeProjectPath(
          result.filename
        ) ===
        normalizeProjectPath(
          selectedMain || ""
        )
    );

  if (
    !selectedMetadataResult
  ) {
    addResult(
      "warning",
      "No selected main document was available for metadata inspection."
    );
  } else {
    const result =
      selectedMetadataResult;

    addDetail(
      result.filename
    );

    addResult(
      result.hasMetadata
        ? "pass"
        : "fail",

      result.hasMetadata
        ? "\\DocumentMetadata found."
        : "\\DocumentMetadata is missing."
    );

    if (
      result.hasMetadata
    ) {
      addResult(
        result
          .metadataBeforeDocumentClass
          ? "pass"
          : "fail",

        result
          .metadataBeforeDocumentClass
          ? "\\DocumentMetadata appears before \\documentclass."
          : "\\DocumentMetadata should appear before \\documentclass."
      );

      addResult(
        result.taggingOn
          ? "pass"
          : "fail",

        result.taggingOn
          ? "tagging=on found."
          : "tagging=on was not found."
      );

      addResult(
        result.ua2
          ? "pass"
          : "warning",

        result.ua2
          ? "pdfstandard=ua-2 found."
          : "pdfstandard=ua-2 was not found."
      );

      addResult(
        result.language
          ? "pass"
          : "warning",

        result.language
          ? "Document language is declared."
          : "No document language declaration was detected."
      );

      addResult(
        result.pdf20
          ? "pass"
          : "warning",

        result.pdf20
          ? "PDF version 2.0 is explicitly requested."
          : "pdfversion=2.0 was not detected."
      );

      addResult(
        result.mathMLSE
          ? "pass"
          : "fail",

        result.mathMLSE
          ? "MathML Structure Element setup found."
          : "math/setup=mathml-SE was not found inside \\DocumentMetadata."
      );
    }
  }


  /* ---------------------------------------------------------
     MATH ACCESSIBILITY
     --------------------------------------------------------- */

  addSectionHeading(
    "Math accessibility"
  );

  const scopedFiles =
    getScopedFiles(
      data.files,
      currentDependencyGraph
    );

  const scopedMathMLFiles =
    scopedFiles.filter(file =>
      /math\s*\/\s*setup\s*=\s*mathml-SE/i
        .test(file.content)
    );

  if (
    scopedMathMLFiles.length >
    0
  ) {
    addResult(
      "pass",
      "math/setup=mathml-SE was detected in the selected project scope."
    );

    scopedMathMLFiles
      .forEach(file => {
        addDetail(
          file.filename
        );
      });
  } else {
    addResult(
      "fail",
      "math/setup=mathml-SE was not detected in the selected project scope."
    );
  }


  /* ---------------------------------------------------------
     LUAMML
     --------------------------------------------------------- */

  addSectionHeading(
    "LuaMML compatibility"
  );

  const scopedLuaMMLDisabledFiles =
    scopedFiles.filter(file =>
      /math\s*\/\s*mathml\s*\/\s*luamml\s*\/\s*load\s*=\s*false/i
        .test(file.content)
    );

  if (
    scopedLuaMMLDisabledFiles
      .length === 0
  ) {
    addResult(
      "pass",
      "No setting that explicitly disables LuaMML was detected in the selected project scope."
    );
  } else {
    addResult(
      "fail",
      "LuaMML is explicitly disabled. This prevents MathML from being generated."
    );

    scopedLuaMMLDisabledFiles
      .forEach(file => {
        addDetail(
          `${file.filename} contains math/mathml/luamml/load=false`
        );
      });
  }


  /* ---------------------------------------------------------
     SOURCE MODERNIZATION
     --------------------------------------------------------- */

  addSectionHeading(
    "Source modernization"
  );

  const modernization =
    analyzeSourceModernization(
      data.files,
      currentDependencyGraph
    );

  /*
   * $$ ... $$ detection
   */

  if (
    modernization
      .displayMathCount === 0
  ) {
    addResult(
      "pass",
      "No plain-TeX $$...$$ display math requiring conversion was detected."
    );
  } else {
    addResult(
      "warning",
      `${modernization.displayMathCount} plain-TeX $$...$$ display math occurrence(s) detected. The accessible-copy fixer will convert them to \\[...\\].`
    );
  }

  if (
    modernization
      .unmatchedDisplayMathCount >
    0
  ) {
    addResult(
      "warning",
      `${modernization.unmatchedDisplayMathCount} unmatched or ambiguous $$ delimiter occurrence(s) require manual review. They will not be changed automatically.`
    );
  }

  /*
   * Enumerate detection
   */

  if (
    modernization
      .enumerateConvertedCount ===
      0 &&
    modernization
      .enumerateReviewCount === 0
  ) {
    addResult(
      "pass",
      "No recognized legacy enumerate label syntax requiring migration was detected."
    );
  }

  if (
    modernization
      .enumerateConvertedCount >
    0
  ) {
    if (
      modernization
        .canApplyEnumerateMigration
    ) {
      addResult(
        "warning",
        `${modernization.enumerateConvertedCount} legacy enumerate option(s) can be migrated automatically to enumitem syntax.`
      );
    } else {
      addResult(
        "warning",
        `${modernization.enumerateConvertedCount} recognizable legacy enumerate option(s) were found, but automatic migration is disabled because other list options require review.`
      );
    }
  }

  if (
    modernization
      .enumerateReviewCount >
    0
  ) {
    addResult(
      "warning",
      `${modernization.enumerateReviewCount} enumerate option(s) could not be classified safely and will not be changed automatically.`
    );

    modernization
      .enumerateReviewOptions
      .forEach(option => {
        addDetail(
          `Review: [${option}]`
        );
      });
  }

  if (
    modernization
      .canRemoveLegacyEnumerate
  ) {
    addDetail(
      "The legacy enumerate package can be removed after successful migration."
    );
  }

  if (
    modernization
      .enumerateConvertedCount >
      0 &&
    !modernization
      .enumitemPackageLoaded &&
    modernization
      .canApplyEnumerateMigration
  ) {
    addDetail(
      "The fixer will add \\usepackage{enumitem} to the selected main document."
    );
  }


  /* ---------------------------------------------------------
     PACKAGE COMPATIBILITY
     --------------------------------------------------------- */

  addSectionHeading(
    "Package compatibility"
  );

  const packageCompatibility =
    analyzePackageCompatibility(
      data.files,
      currentDependencyGraph
    );

  if (
    packageCompatibility.length ===
    0
  ) {
    addResult(
      "pass",
      "None of the currently tracked incompatible packages were detected in the selected project scope."
    );
  } else {
    packageCompatibility.forEach(
      item => {
        if (
          item.packageName ===
            "systeme" &&
          item.autoRemove
        ) {
          addResult(
            "warning",
            "systeme is currently incompatible with LuaMML, but it appears unused. The accessible-copy fixer will remove it automatically."
          );

        } else if (
          item.packageName ===
            "enumerate" &&
          modernization
            .canRemoveLegacyEnumerate
        ) {
          addResult(
            "warning",
            "The legacy enumerate package is present. Recognized legacy list labels can be migrated safely, after which the fixer will remove the package."
          );

        } else {
          addResult(
            "warning",
            `${item.packageName}: ${item.status}. ${item.note}`
          );
        }

        item.loadedIn.forEach(
          filename => {
            addDetail(
              `Loaded in: ${filename}`
            );
          }
        );

        if (
          item.packageName ===
          "systeme"
        ) {
          addDetail(
            item.usageCount === 0
              ? "No systeme-specific command was detected in the selected project scope."
              : `${item.usageCount} systeme-specific command usage(s) detected; automatic removal will not be performed.`
          );
        }

        if (
          item.packageName ===
          "esvect"
        ) {
          addDetail(
            item.usageCount === 0
              ? "No \\vv command was detected in the selected project scope."
              : `${item.usageCount} \\vv usage(s) detected; no automatic change will be made.`
          );
        }
      }
    );
  }
}


/* =========================================================
   REPORT UI HELPERS
   ========================================================= */

function addSectionHeading(text) {
  const heading =
    document.createElement("h3");

  heading.textContent = text;

  report.appendChild(
    heading
  );
}


function addResult(type, text) {
  const item =
    document.createElement("div");

  item.className =
    `result ${type}`;

  let prefix = "";

  if (type === "pass") {
    prefix = "✓ ";
  } else if (
    type === "fail"
  ) {
    prefix = "✕ ";
  } else {
    prefix = "⚠ ";
  }

  item.textContent =
    prefix + text;

  report.appendChild(
    item
  );
}


function addDetail(text) {
  const detail =
    document.createElement("div");

  detail.className =
    "detail";

  detail.textContent =
    text;

  report.appendChild(
    detail
  );
}


function showMessage(message) {
  report.textContent = "";

  const paragraph =
    document.createElement("p");

  paragraph.textContent =
    message;

  report.appendChild(
    paragraph
  );
}


/* =========================================================
   CREATE ACCESSIBLE COPY
   ========================================================= */

fixButton.addEventListener(
  "click",
  async () => {
    if (
      !currentProjectFile
    ) {
      alert(
        "Please check a project first."
      );

      return;
    }

    if (
      !mainDocumentSelect.value
    ) {
      alert(
        "Please select the main LaTeX document."
      );

      return;
    }

    const originalButtonText =
      fixButton.textContent;

    fixButton.disabled = true;

    fixButton.textContent =
      "Creating Accessible Copy...";

    try {
      const outputZip =
        await JSZip.loadAsync(
          currentProjectFile
        );

      const rootFilename =
        normalizeProjectPath(
          mainDocumentSelect.value
        );

      const projectScope =
        buildDependencyGraph(
          rootFilename,
          currentLatexFiles
        );

      const filesToFix =
        projectScope.usedFiles;

      const changes = [];

      const packageCompatibility =
        analyzePackageCompatibility(
          currentLatexFiles,
          projectScope
        );

      const modernization =
        analyzeSourceModernization(
          currentLatexFiles,
          projectScope
        );

      const removeUnusedSysteme =
        packageCompatibility.some(
          item =>
            item.packageName ===
              "systeme" &&
            item.autoRemove
        );

      const removeLegacyEnumerate =
        modernization
          .canRemoveLegacyEnumerate;

      const shouldMigrateEnumerate =
        modernization
          .canApplyEnumerateMigration;

      const shouldEnsureEnumitem =
        shouldMigrateEnumerate &&
        modernization
          .enumerateConvertedCount >
          0 &&
        !modernization
          .enumitemPackageLoaded;

      for (
        const [
          rawFilename,
          zipEntry
        ]
        of Object.entries(
          outputZip.files
        )
      ) {
        if (zipEntry.dir) {
          continue;
        }

        const filename =
          normalizeProjectPath(
            rawFilename
          );

        const lowerName =
          filename.toLowerCase();

        if (
          !lowerName.endsWith(
            ".tex"
          ) &&
          !lowerName.endsWith(
            ".sty"
          ) &&
          !lowerName.endsWith(
            ".cls"
          )
        ) {
          continue;
        }

        /*
         * Only modify files used by
         * the selected document.
         */

        if (
          !filesToFix.has(
            filename
          )
        ) {
          continue;
        }

        let source =
          await zipEntry.async(
            "string"
          );

        const originalSource =
          source;

        /*
         * ---------------------------------------------------
         * Source modernization.
         *
         * Only .tex files are automatically modernized.
         * ---------------------------------------------------
         */

        if (
          lowerName.endsWith(
            ".tex"
          )
        ) {
          /*
           * $$ ... $$ → \[ ... \]
           */

          const displayResult =
            convertDoubleDollarDisplays(
              source
            );

          source =
            displayResult.source;

          displayResult
            .changes
            .forEach(change => {
              changes.push(
                `${filename}: ${change}`
              );
            });

          /*
           * Legacy enumerate syntax.
           */

          if (
            shouldMigrateEnumerate
          ) {
            const enumerateResult =
              migrateLegacyEnumerateSyntax(
                source
              );

            source =
              enumerateResult.source;

            enumerateResult
              .changes
              .forEach(change => {
                changes.push(
                  `${filename}: ${change}`
                );
              });
          }
        }

        /*
         * ---------------------------------------------------
         * Remove unused systeme.
         * ---------------------------------------------------
         */

        if (
          removeUnusedSysteme
        ) {
          const packageResult =
            removePackageFromSource(
              source,
              "systeme"
            );

          source =
            packageResult.source;

          packageResult
            .changes
            .forEach(change => {
              changes.push(
                `${filename}: ${change}`
              );
            });
        }

        /*
         * ---------------------------------------------------
         * Remove legacy enumerate after successful migration.
         * ---------------------------------------------------
         */

        if (
          removeLegacyEnumerate
        ) {
          const packageResult =
            removePackageFromSource(
              source,
              "enumerate"
            );

          source =
            packageResult.source;

          packageResult
            .changes
            .forEach(change => {
              changes.push(
                `${filename}: ${change}`
              );
            });
        }

        /*
         * ---------------------------------------------------
         * Selected main document.
         * ---------------------------------------------------
         */

        if (
          filename ===
          rootFilename
        ) {
          /*
           * Add enumitem if legacy enumerate
           * syntax was migrated and enumitem
           * was not previously present.
           */

          if (
            shouldEnsureEnumitem
          ) {
            const packageResult =
              ensurePackageInMainDocument(
                source,
                "enumitem"
              );

            source =
              packageResult.source;

            packageResult
              .changes
              .forEach(change => {
                changes.push(
                  `${filename}: ${change}`
                );
              });
          }

          /*
           * Accessibility metadata.
           */

          const metadataResult =
            ensureAccessibleDocumentMetadata(
              source
            );

          source =
            metadataResult.source;

          metadataResult
            .changes
            .forEach(change => {
              changes.push(
                `${filename}: ${change}`
              );
            });
        }

        /*
         * ---------------------------------------------------
         * Remove explicit LuaMML disabling.
         * ---------------------------------------------------
         */

        const luammlResult =
          removeLuaMMLDisablingSettings(
            source
          );

        source =
          luammlResult.source;

        luammlResult
          .changes
          .forEach(change => {
            changes.push(
              `${filename}: ${change}`
            );
          });

        if (
          source !==
          originalSource
        ) {
          outputZip.file(
            rawFilename,
            source
          );
        }
      }

      const reportText =
        buildAccessibilityChangesReport(
          rootFilename,
          changes,
          projectScope,
          packageCompatibility,
          modernization
        );

      outputZip.file(
        "ACCESSIBILITY_CHANGES.txt",
        reportText
      );

      const blob =
        await outputZip.generateAsync({
          type:
            "blob"
        });

      const outputName =
        createAccessibleFilename(
          currentProjectFile.name
        );

      downloadBlob(
        blob,
        outputName
      );

      addSectionHeading(
        "Accessible copy"
      );

      addResult(
        "pass",
        `Created ${outputName}.`
      );

      addDetail(
        "Your original ZIP was not changed."
      );

      if (
        changes.length > 0
      ) {
        addDetail(
          `${changes.length} source change record(s) were written to ACCESSIBILITY_CHANGES.txt.`
        );
      }

      if (
        modernization
          .unmatchedDisplayMathCount >
        0
      ) {
        addResult(
          "warning",
          "Some ambiguous or unmatched $$ delimiters still require manual review."
        );
      }

      if (
        modernization
          .enumerateReviewCount >
        0
      ) {
        addResult(
          "warning",
          "Some enumerate options still require manual review."
        );
      }

    } catch (error) {
      console.error(error);

      alert(
        "The accessible copy could not be created. See the browser console for details."
      );

    } finally {
      fixButton.disabled =
        currentRootDocuments
          .length === 0;

      fixButton.textContent =
        originalButtonText;
    }
  }
);


/* =========================================================
   ACCESSIBILITY METADATA FIXER
   ========================================================= */

function ensureAccessibleDocumentMetadata(
  source
) {
  const changes = [];

  const metadataRange =
    findDocumentMetadata(
      source
    );

  const documentClassMatch =
    source.match(
      /\\documentclass(?:\s*\[[^\]]*\])?\s*\{/
    );

  if (
    !documentClassMatch
  ) {
    return {
      source,
      changes
    };
  }

  const documentClassIndex =
    documentClassMatch.index;

  /*
   * CASE 1:
   * No \DocumentMetadata exists.
   */

  if (
    !metadataRange
  ) {
    const metadata =
`\\DocumentMetadata{
  lang=en-US,
  pdfversion=2.0,
  pdfstandard=ua-2,
  tagging=on,
  tagging-setup={math/setup=mathml-SE}
}

`;

    source =
      source.slice(
        0,
        documentClassIndex
      ) +
      metadata +
      source.slice(
        documentClassIndex
      );

    changes.push(
      "Added accessible \\DocumentMetadata before \\documentclass."
    );

    return {
      source,
      changes
    };
  }

  /*
   * CASE 2:
   * Metadata already exists.
   */

  const metadataContent =
    source.slice(
      metadataRange.contentStart,
      metadataRange.contentEnd
    );

  let entries =
    splitTopLevelCommaList(
      metadataContent
    );

  entries =
    setMetadataEntry(
      entries,
      "lang",
      "en-US"
    );

  entries =
    setMetadataEntry(
      entries,
      "pdfversion",
      "2.0"
    );

  entries =
    setMetadataEntry(
      entries,
      "pdfstandard",
      "ua-2"
    );

  entries =
    setMetadataEntry(
      entries,
      "tagging",
      "on"
    );

  entries =
    ensureMathMLTaggingSetup(
      entries
    );

  const newMetadata =
`\\DocumentMetadata{
  ${entries
    .map(
      entry =>
        entry.trim()
    )
    .filter(Boolean)
    .join(",\n  ")}
}`;

  source =
    source.slice(
      0,
      metadataRange.start
    ) +
    newMetadata +
    source.slice(
      metadataRange.end
    );

  changes.push(
    "Updated \\DocumentMetadata for PDF/UA-2 tagging and MathML-SE."
  );

  return {
    source,
    changes
  };
}


function findDocumentMetadata(
  source
) {
  const command =
    "\\DocumentMetadata";

  const position =
    source.indexOf(command);

  if (
    position === -1
  ) {
    return null;
  }

  let openBrace =
    position +
    command.length;

  while (
    openBrace <
      source.length &&
    /\s/.test(
      source[openBrace]
    )
  ) {
    openBrace++;
  }

  if (
    source[openBrace] !==
    "{"
  ) {
    return null;
  }

  let depth = 0;

  for (
    let i = openBrace;
    i < source.length;
    i++
  ) {
    const char =
      source[i];

    if (
      char === "{" &&
      !isCharacterEscaped(
        source,
        i
      )
    ) {
      depth++;
    }

    if (
      char === "}" &&
      !isCharacterEscaped(
        source,
        i
      )
    ) {
      depth--;

      if (
        depth === 0
      ) {
        return {
          start:
            position,

          end:
            i + 1,

          contentStart:
            openBrace + 1,

          contentEnd:
            i
        };
      }
    }
  }

  return null;
}


function isCharacterEscaped(
  text,
  position
) {
  let backslashes = 0;

  for (
    let i = position - 1;
    i >= 0 &&
      text[i] === "\\";
    i--
  ) {
    backslashes++;
  }

  return (
    backslashes % 2 === 1
  );
}


function splitTopLevelCommaList(
  text
) {
  const entries = [];
  let current = "";

  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let inComment = false;

  for (
    let i = 0;
    i < text.length;
    i++
  ) {
    const char = text[i];

    if (inComment) {
      current += char;

      if (
        char === "\n"
      ) {
        inComment = false;
      }

      continue;
    }

    if (
      char === "%" &&
      !isCharacterEscaped(
        text,
        i
      )
    ) {
      inComment = true;
      current += char;
      continue;
    }

    if (
      char === "{" &&
      !isCharacterEscaped(
        text,
        i
      )
    ) {
      braceDepth++;
    }

    if (
      char === "}" &&
      !isCharacterEscaped(
        text,
        i
      )
    ) {
      braceDepth--;
    }

    if (
      char === "[" &&
      !isCharacterEscaped(
        text,
        i
      )
    ) {
      bracketDepth++;
    }

    if (
      char === "]" &&
      !isCharacterEscaped(
        text,
        i
      )
    ) {
      bracketDepth--;
    }

    if (
      char === "(" &&
      !isCharacterEscaped(
        text,
        i
      )
    ) {
      parenthesisDepth++;
    }

    if (
      char === ")" &&
      !isCharacterEscaped(
        text,
        i
      )
    ) {
      parenthesisDepth--;
    }

    if (
      char === "," &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenthesisDepth ===
        0
    ) {
      entries.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (
    current.trim()
  ) {
    entries.push(current);
  }

  return entries;
}


function setMetadataEntry(
  entries,
  key,
  value
) {
  const escapedKey =
    key.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const pattern =
    new RegExp(
      "^\\s*" +
      escapedKey +
      "\\s*="
    );

  let replaced = false;

  const result = [];

  for (
    const entry
    of entries
  ) {
    if (
      pattern.test(
        entry.trim()
      )
    ) {
      if (!replaced) {
        result.push(
          `${key}=${value}`
        );

        replaced = true;
      }

      continue;
    }

    result.push(entry);
  }

  if (!replaced) {
    result.push(
      `${key}=${value}`
    );
  }

  return result;
}


function ensureMathMLTaggingSetup(
  entries
) {
  const pattern =
    /^\s*tagging-setup\s*=/;

  const index =
    entries.findIndex(
      entry =>
        pattern.test(
          entry.trim()
        )
    );

  if (
    index === -1
  ) {
    entries.push(
      "tagging-setup={math/setup=mathml-SE}"
    );

    return entries;
  }

  const entry =
    entries[index].trim();

  const equalsPosition =
    entry.indexOf("=");

  let value =
    entry.slice(
      equalsPosition + 1
    ).trim();

  if (
    value.startsWith("{") &&
    value.endsWith("}")
  ) {
    value =
      value.slice(1, -1);
  }

  let setupEntries =
    splitTopLevelCommaList(
      value
    );

  setupEntries =
    setMetadataEntry(
      setupEntries,
      "math/setup",
      "mathml-SE"
    );

  entries[index] =
    `tagging-setup={${setupEntries
      .map(
        item =>
          item.trim()
      )
      .filter(Boolean)
      .join(", ")}}`;

  return entries;
}


/* =========================================================
   LUAMML FIXER
   ========================================================= */

function removeLuaMMLDisablingSettings(
  source
) {
  const changes = [];

  const conditionalPattern =
    /\\IfPackageAtLeastTF\s*\{tagpdf\}\s*\{[^}]*\}\s*\{\s*\\tagpdfsetup\s*\{\s*math\s*\/\s*mathml\s*\/\s*luamml\s*\/\s*load\s*=\s*false\s*\}\s*\}\s*\{\s*\}/gs;

  if (
    conditionalPattern.test(
      source
    )
  ) {
    source =
      source.replace(
        conditionalPattern,
        ""
      );

    changes.push(
      "Removed conditional setting that disabled LuaMML."
    );
  }

  const directPattern =
    /\\tagpdfsetup\s*\{\s*math\s*\/\s*mathml\s*\/\s*luamml\s*\/\s*load\s*=\s*false\s*\}/gs;

  if (
    directPattern.test(
      source
    )
  ) {
    source =
      source.replace(
        directPattern,
        ""
      );

    changes.push(
      "Removed math/mathml/luamml/load=false."
    );
  }

  return {
    source,
    changes
  };
}


/* =========================================================
   CHANGE REPORT + DOWNLOAD
   ========================================================= */

function buildAccessibilityChangesReport(
  rootFilename,
  changes,
  projectScope,
  packageCompatibility = [],
  modernization = null
) {
  let text =
`LATEX ACCESSIBILITY PROJECT FIXER
=================================

Main document:
${rootFilename}

Project scope:
${projectScope.usedFiles.size} LaTeX project file(s) used by the selected document.

Changes made
------------
`;

  if (
    changes.length === 0
  ) {
    text +=
`No source changes were necessary.
`;
  } else {
    changes.forEach(
      change => {
        text +=
          `- ${change}\n`;
      }
    );
  }

  let warningHeadingAdded =
    false;

  function ensureWarningsHeading() {
    if (
      warningHeadingAdded
    ) {
      return;
    }

    text +=
`
Warnings
--------
`;

    warningHeadingAdded =
      true;
  }

  if (
    projectScope
      .missing.length >
    0
  ) {
    ensureWarningsHeading();

    projectScope
      .missing
      .forEach(item => {
        text +=
          `- Missing reference: ${item.from} -> ${item.target}\n`;
      });
  }

  if (
    projectScope
      .dynamic.length >
    0
  ) {
    ensureWarningsHeading();

    projectScope
      .dynamic
      .forEach(item => {
        text +=
          `- Dynamic reference requires review: ${item.from} -> ${item.target}\n`;
      });
  }

  if (modernization) {
    if (
      modernization
        .unmatchedDisplayMathCount >
      0
    ) {
      ensureWarningsHeading();

      text +=
        `- ${modernization.unmatchedDisplayMathCount} unmatched or ambiguous $$ delimiter occurrence(s) require manual review.\n`;
    }

    if (
      modernization
        .enumerateReviewCount >
      0
    ) {
      ensureWarningsHeading();

      text +=
        `- ${modernization.enumerateReviewCount} enumerate option(s) require manual review.\n`;

      modernization
        .enumerateReviewOptions
        .forEach(option => {
          text +=
            `  Review list option: [${option}]\n`;
        });
    }

    if (
      modernization
        .enumerateConvertedCount >
        0 &&
      !modernization
        .canApplyEnumerateMigration
    ) {
      ensureWarningsHeading();

      text +=
        "- Recognized legacy enumerate syntax was not changed because unresolved list options remain in a project using the legacy enumerate package.\n";
    }
  }

  if (
    packageCompatibility.length >
    0
  ) {
    text +=
`
Package compatibility review
----------------------------
`;

    packageCompatibility
      .forEach(item => {
        if (
          item.packageName ===
            "systeme" &&
          item.autoRemove
        ) {
          text +=
            "- systeme: loaded but no systeme-specific command usage detected; package declaration removed automatically.\n";

        } else if (
          item.packageName ===
            "enumerate" &&
          modernization &&
          modernization
            .canRemoveLegacyEnumerate
        ) {
          text +=
            "- enumerate: legacy list syntax migrated to enumitem and the legacy package declaration removed.\n";

        } else {
          text +=
            `- ${item.packageName}: ${item.status}. ${item.note}\n`;
        }
      });
  }

  text +=
`
IMPORTANT
---------

This tool prepares the LaTeX project for accessible PDF generation.

It does NOT guarantee that the project will compile successfully
with MathML enabled.

Next steps:

1. Upload this ZIP to Overleaf.
2. Select LuaLaTeX as the compiler.
3. Use a current TeX Live release.
4. Recompile from scratch.
5. Check the resulting PDF with an accessibility validator.
6. Review figure alt text manually.
7. Test important mathematical content with a screen reader.

Custom macros, environments, classes, and mathematical content
have otherwise been preserved.
`;

  return text;
}


function createAccessibleFilename(
  filename
) {
  const base =
    filename.replace(
      /\.zip$/i,
      ""
    );

  return (
    `${base}_Accessible.zip`
  );
}


function downloadBlob(
  blob,
  filename
) {
  const url =
    URL.createObjectURL(
      blob
    );

  const link =
    document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(
    link
  );

  link.click();
  link.remove();

  URL.revokeObjectURL(
    url
  );
}
