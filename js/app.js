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

// Small, conservative compatibility list based on issues we have
// actually encountered in course-note projects. These rules are
// intentionally local to the browser app; they do not modify a
// project unless a fix is marked safe.
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

    for (const [filename, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue;

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
        const rawContent = await zipEntry.async("string");

        latexFiles.push({
          filename: normalizeProjectPath(filename),
          rawContent,
          content: stripLatexComments(rawContent)
        });
      }
    }

    currentLatexFiles = latexFiles;
    analyzeProject(file.name, latexFiles);

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

  const rootDocuments = files.filter(file =>
    /\\documentclass(?:\s*\[[^\]]*\])?\s*\{/.test(file.content)
  );

  currentRootDocuments = rootDocuments.map(file => file.filename);

  updateMainDocumentSelector();

  const metadataFiles = files.filter(file =>
    file.content.includes("\\DocumentMetadata")
  );

  const mathMLFiles = files.filter(file =>
    /math\s*\/\s*setup\s*=\s*mathml-SE/i.test(file.content)
  );

  const luaMMLDisabledFiles = files.filter(file =>
    /math\s*\/\s*mathml\s*\/\s*luamml\s*\/\s*load\s*=\s*false/i.test(
      file.content
    )
  );

  const metadataResults = rootDocuments.map(root =>
    inspectRootDocument(root)
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

  renderReport(currentAnalysisData);
}


function updateMainDocumentSelector() {
  mainDocumentSelect.innerHTML = "";

  if (currentRootDocuments.length === 0) {
    mainDocumentArea.hidden = true;
    fixButton.disabled = true;
    currentDependencyGraph = null;
    return;
  }

  currentRootDocuments.forEach(filename => {
    const option = document.createElement("option");
    option.value = filename;
    option.textContent = filename;
    mainDocumentSelect.appendChild(option);
  });

  // Prefer a root-level main.tex first. Only fall back to a nested
  // */main.tex if the project does not have one at the root.
  let preferredMain = currentRootDocuments.find(filename =>
    normalizeProjectPath(filename).toLowerCase() === "main.tex"
  );

  if (!preferredMain) {
    preferredMain = currentRootDocuments.find(filename =>
      normalizeProjectPath(filename)
        .toLowerCase()
        .endsWith("/main.tex")
    );
  }

  if (preferredMain) {
    mainDocumentSelect.value = preferredMain;
  }

  mainDocumentArea.hidden = false;
  fixButton.disabled = false;

  currentDependencyGraph = buildDependencyGraph(
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

  const documentClassIndex = content.search(/\\documentclass/);
  const metadataIndex = content.search(/\\DocumentMetadata/);

  let metadata = "";

  if (metadataIndex !== -1) {
    metadata = extractCommandArgument(
      content,
      metadataIndex,
      "\\DocumentMetadata"
    );
  }

  return {
    filename: file.filename,

    hasMetadata:
      metadataIndex !== -1,

    metadataBeforeDocumentClass:
      metadataIndex !== -1 &&
      documentClassIndex !== -1 &&
      metadataIndex < documentClassIndex,

    taggingOn:
      /tagging\s*=\s*on/i.test(metadata),

    ua2:
      /pdfstandard\s*=\s*ua-2/i.test(metadata),

    language:
      /lang\s*=\s*[a-z]{2}(?:-[A-Z]{2})?/i.test(metadata),

    pdf20:
      /pdfversion\s*=\s*2(?:\.0)?/i.test(metadata),

    mathMLSE:
      /math\s*\/\s*setup\s*=\s*mathml-SE/i.test(metadata)
  };
}


function extractCommandArgument(text, commandPosition, commandName) {
  let position = commandPosition + commandName.length;

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

  for (let i = position; i < text.length; i++) {
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
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== "%") continue;

        let backslashes = 0;

        for (
          let j = i - 1;
          j >= 0 && line[j] === "\\";
          j--
        ) {
          backslashes++;
        }

        if (backslashes % 2 === 0) {
          return line.substring(0, i);
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
      if (!part || part === ".") {
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
  const normalized = normalizeProjectPath(filename);
  const slash = normalized.lastIndexOf("/");

  return slash === -1
    ? ""
    : normalized.slice(0, slash);
}


function joinProjectPath(directory, target) {
  if (!directory) {
    return normalizeProjectPath(target);
  }

  return normalizeProjectPath(
    `${directory}/${target}`
  );
}


function looksDynamicReference(target) {
  return (
    target.includes("\\") ||
    target.includes("#") ||
    target.includes("$")
  );
}


function extractDependencies(file) {
  const dependencies = [];
  const content = file.content;

  // \input, \include, \subfile
  const texPattern =
    /\\(input|include|subfile)\s*\{([^{}]+)\}/g;

  let match;

  while (
    (match = texPattern.exec(content)) !== null
  ) {
    dependencies.push({
      type: match[1],
      target: match[2].trim(),
      required: true
    });
  }

  // Local packages
  const packagePattern =
    /\\(?:usepackage|RequirePackage)(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g;

  while (
    (match = packagePattern.exec(content)) !== null
  ) {
    match[1]
      .split(",")
      .map(name => name.trim())
      .filter(Boolean)
      .forEach(name => {
        dependencies.push({
          type: "package",
          target: name,
          required: false
        });
      });
  }

  // Local document class
  const classPattern =
    /\\documentclass(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g;

  while (
    (match = classPattern.exec(content)) !== null
  ) {
    dependencies.push({
      type: "class",
      target: match[1].trim(),
      required: false
    });
  }

  return dependencies;
}


function resolveDependency(
  fromFilename,
  dependency,
  fileMap
) {
  const target = dependency.target;

  if (looksDynamicReference(target)) {
    return {
      status: "dynamic",
      target
    };
  }

  const directory = getDirectory(fromFilename);
  let candidates = [];

  if (
    dependency.type === "input" ||
    dependency.type === "include" ||
    dependency.type === "subfile"
  ) {
    // Relative to current file.
    candidates.push(
      joinProjectPath(directory, target)
    );

    // Relative to project root.
    candidates.push(
      normalizeProjectPath(target)
    );

    if (!/\.[A-Za-z0-9]+$/.test(target)) {
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

  if (dependency.type === "package") {
    const packageTarget = /\.sty$/i.test(target)
      ? target
      : `${target}.sty`;

    candidates.push(
      joinProjectPath(
        directory,
        packageTarget
      )
    );

    candidates.push(
      normalizeProjectPath(packageTarget)
    );
  }

  if (dependency.type === "class") {
    const classTarget = /\.cls$/i.test(target)
      ? target
      : `${target}.cls`;

    candidates.push(
      joinProjectPath(
        directory,
        classTarget
      )
    );

    candidates.push(
      normalizeProjectPath(classTarget)
    );
  }

  candidates = [...new Set(candidates)];

  for (const candidate of candidates) {
    if (fileMap.has(candidate)) {
      return {
        status: "found",
        filename: candidate
      };
    }
  }

  if (dependency.required) {
    return {
      status: "missing",
      target
    };
  }

  return {
    status: "external",
    target
  };
}


function buildDependencyGraph(
  rootFilename,
  files
) {
  const fileMap = new Map();

  files.forEach(file => {
    fileMap.set(
      normalizeProjectPath(file.filename),
      file
    );
  });

  const root = normalizeProjectPath(rootFilename);
  const usedFiles = new Set();
  const edges = [];
  const missing = [];
  const dynamic = [];

  function visit(filename) {
    if (usedFiles.has(filename)) {
      return;
    }

    const file = fileMap.get(filename);

    if (!file) {
      return;
    }

    usedFiles.add(filename);

    const dependencies = extractDependencies(file);

    dependencies.forEach(dependency => {
      const resolution = resolveDependency(
        filename,
        dependency,
        fileMap
      );

      if (resolution.status === "found") {
        edges.push({
          from: filename,
          to: resolution.filename,
          type: dependency.type
        });

        visit(resolution.filename);
      }

      if (resolution.status === "missing") {
        missing.push({
          from: filename,
          target: dependency.target,
          type: dependency.type
        });
      }

      if (resolution.status === "dynamic") {
        dynamic.push({
          from: filename,
          target: dependency.target,
          type: dependency.type
        });
      }
    });
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
   PACKAGE COMPATIBILITY ANALYSIS
   ========================================================= */

function getScopedFiles(files, projectScope) {
  if (!projectScope) {
    return [];
  }

  return files.filter(file =>
    projectScope.usedFiles.has(
      normalizeProjectPath(file.filename)
    )
  );
}


function findPackageDeclarations(files, projectScope) {
  const declarations = [];
  const scopedFiles = getScopedFiles(files, projectScope);

  const packagePattern =
    /\\(usepackage|RequirePackage)(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g;

  scopedFiles.forEach(file => {
    let match;

    while (
      (match = packagePattern.exec(file.content)) !== null
    ) {
      match[2]
        .split(",")
        .map(name => name.trim())
        .filter(Boolean)
        .forEach(name => {
          declarations.push({
            filename: file.filename,
            command: match[1],
            packageName: name
          });
        });
    }

    packagePattern.lastIndex = 0;
  });

  return declarations;
}


function countRegexMatches(text, pattern) {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : pattern.flags + "g";

  const regex = new RegExp(pattern.source, flags);
  let count = 0;

  while (regex.exec(text) !== null) {
    count++;

    // Avoid an infinite loop for a zero-length regular expression.
    if (regex.lastIndex === 0) {
      regex.lastIndex++;
    }
  }

  return count;
}


function analyzePackageCompatibility(files, projectScope) {
  if (!projectScope) {
    return [];
  }

  const declarations =
    findPackageDeclarations(files, projectScope);

  const scopedFiles = getScopedFiles(files, projectScope);
  const combinedContent = scopedFiles
    .map(file => file.content)
    .join("\n");

  const results = [];

  Object.entries(PACKAGE_COMPATIBILITY_RULES)
    .forEach(([packageName, rule]) => {
      const loadedIn = declarations
        .filter(item =>
          item.packageName.toLowerCase() ===
          packageName.toLowerCase()
        )
        .map(item => item.filename);

      if (loadedIn.length === 0) {
        return;
      }

      let usageCount = 0;

      rule.usagePatterns.forEach(pattern => {
        usageCount += countRegexMatches(
          combinedContent,
          pattern
        );
      });

      const appearsUnused =
        rule.usagePatterns.length > 0 &&
        usageCount === 0;

      results.push({
        packageName,
        status: rule.status,
        note: rule.note,
        loadedIn: [...new Set(loadedIn)],
        usageCount,
        appearsUnused,
        autoRemove:
          Boolean(rule.autoRemoveIfUnused) &&
          appearsUnused
      });
    });

  return results;
}


function removePackageFromSource(source, packageName) {
  const changes = [];

  const packagePattern =
    /\\(usepackage|RequirePackage)(\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g;

  source = source.replace(
    packagePattern,
    (fullMatch, command, options = "", packageList) => {
      const packages = packageList
        .split(",")
        .map(name => name.trim())
        .filter(Boolean);

      const hasTarget = packages.some(name =>
        name.toLowerCase() === packageName.toLowerCase()
      );

      if (!hasTarget) {
        return fullMatch;
      }

      const remaining = packages.filter(name =>
        name.toLowerCase() !== packageName.toLowerCase()
      );

      changes.push(
        `Removed unused incompatible package ${packageName}.`
      );

      if (remaining.length === 0) {
        return "";
      }

      return `\\${command}${options || ""}{${remaining.join(",")}}`;
    }
  );

  return {
    source,
    changes
  };
}


/* =========================================================
   REPORT
   ========================================================= */

function renderReport(data) {
  report.innerHTML = "";

  const title = document.createElement("h3");
  title.textContent = `Project: ${data.projectName}`;
  report.appendChild(title);

  const summary = document.createElement("p");
  summary.textContent =
    `Analyzed ${data.files.length} LaTeX project file(s).`;
  report.appendChild(summary);


  // MAIN DOCUMENTS
  addSectionHeading("Main document detection");

  if (data.rootDocuments.length === 0) {
    addResult(
      "warning",
      "No file containing \\documentclass was found."
    );
  } else {
    addResult(
      "pass",
      `${data.rootDocuments.length} candidate main document(s) found.`
    );

    data.rootDocuments.forEach(file => {
      addDetail(file.filename);
    });
  }


  // SELECTED PROJECT SCOPE
  addSectionHeading("Selected project scope");

  if (!currentDependencyGraph) {
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

    if (currentDependencyGraph.missing.length === 0) {
      addResult(
        "pass",
        "No missing input/include/subfile files were detected."
      );
    } else {
      addResult(
        "warning",
        `${currentDependencyGraph.missing.length} referenced file(s) could not be found.`
      );

      currentDependencyGraph.missing.forEach(item => {
        addDetail(
          `${item.from} → ${item.target}`
        );
      });
    }

    if (currentDependencyGraph.dynamic.length > 0) {
      addResult(
        "warning",
        `${currentDependencyGraph.dynamic.length} dynamic file reference(s) require manual review.`
      );

      currentDependencyGraph.dynamic.forEach(item => {
        addDetail(
          `${item.from} → ${item.target}`
        );
      });
    }
  }


  // DOCUMENT METADATA
  addSectionHeading("Document metadata");

  const selectedMain = currentDependencyGraph
    ? currentDependencyGraph.root
    : mainDocumentSelect.value;

  const selectedMetadataResult =
    data.metadataResults.find(result =>
      normalizeProjectPath(result.filename) ===
      normalizeProjectPath(selectedMain || "")
    );

  if (!selectedMetadataResult) {
    addResult(
      "warning",
      "No selected main document was available for metadata inspection."
    );
  } else {
    const result = selectedMetadataResult;

    addDetail(result.filename);

    addResult(
      result.hasMetadata ? "pass" : "fail",
      result.hasMetadata
        ? "\\DocumentMetadata found."
        : "\\DocumentMetadata is missing."
    );

    if (result.hasMetadata) {
      addResult(
        result.metadataBeforeDocumentClass ? "pass" : "fail",
        result.metadataBeforeDocumentClass
          ? "\\DocumentMetadata appears before \\documentclass."
          : "\\DocumentMetadata should appear before \\documentclass."
      );

      addResult(
        result.taggingOn ? "pass" : "fail",
        result.taggingOn
          ? "tagging=on found."
          : "tagging=on was not found."
      );

      addResult(
        result.ua2 ? "pass" : "warning",
        result.ua2
          ? "pdfstandard=ua-2 found."
          : "pdfstandard=ua-2 was not found."
      );

      addResult(
        result.language ? "pass" : "warning",
        result.language
          ? "Document language is declared."
          : "No document language declaration was detected."
      );

      addResult(
        result.pdf20 ? "pass" : "warning",
        result.pdf20
          ? "PDF version 2.0 is explicitly requested."
          : "pdfversion=2.0 was not detected."
      );

      addResult(
        result.mathMLSE ? "pass" : "fail",
        result.mathMLSE
          ? "MathML Structure Element setup found."
          : "math/setup=mathml-SE was not found inside \\DocumentMetadata."
      );
    }
  }


  // SELECTED-SCOPE MATHML
  addSectionHeading("Math accessibility");

  const scopedFiles = getScopedFiles(
    data.files,
    currentDependencyGraph
  );

  const scopedMathMLFiles = scopedFiles.filter(file =>
    /math\s*\/\s*setup\s*=\s*mathml-SE/i.test(file.content)
  );

  if (scopedMathMLFiles.length > 0) {
    addResult(
      "pass",
      "math/setup=mathml-SE was detected in the selected project scope."
    );

    scopedMathMLFiles.forEach(file => {
      addDetail(file.filename);
    });
  } else {
    addResult(
      "fail",
      "math/setup=mathml-SE was not detected in the selected project scope."
    );
  }


  // LUAMML DISABLING
  addSectionHeading("LuaMML compatibility");

  const scopedLuaMMLDisabledFiles = scopedFiles.filter(file =>
    /math\s*\/\s*mathml\s*\/\s*luamml\s*\/\s*load\s*=\s*false/i.test(
      file.content
    )
  );

  if (scopedLuaMMLDisabledFiles.length === 0) {
    addResult(
      "pass",
      "No setting that explicitly disables LuaMML was detected in the selected project scope."
    );
  } else {
    addResult(
      "fail",
      "LuaMML is explicitly disabled. This prevents MathML from being generated."
    );

    scopedLuaMMLDisabledFiles.forEach(file => {
      addDetail(
        `${file.filename} contains math/mathml/luamml/load=false`
      );
    });
  }


  // PACKAGE COMPATIBILITY
  addSectionHeading("Package compatibility");

  const packageCompatibility =
    analyzePackageCompatibility(
      data.files,
      currentDependencyGraph
    );

  if (packageCompatibility.length === 0) {
    addResult(
      "pass",
      "None of the currently tracked incompatible packages were detected in the selected project scope."
    );
  } else {
    packageCompatibility.forEach(item => {
      if (
        item.packageName === "systeme" &&
        item.autoRemove
      ) {
        addResult(
          "warning",
          "systeme is currently incompatible with LuaMML, but it appears unused. The accessible-copy fixer will remove it automatically."
        );
      } else {
        addResult(
          "warning",
          `${item.packageName}: ${item.status}. ${item.note}`
        );
      }

      item.loadedIn.forEach(filename => {
        addDetail(`Loaded in: ${filename}`);
      });


      if (item.packageName === "systeme") {
        addDetail(
          item.usageCount === 0
            ? "No systeme-specific command was detected in the selected project scope."
            : `${item.usageCount} systeme-specific command usage(s) detected; automatic removal will not be performed.`
        );
      }

      if (item.packageName === "esvect") {
        addDetail(
          item.usageCount === 0
            ? "No \\vv command was detected in the selected project scope."
            : `${item.usageCount} \\vv usage(s) detected; no automatic change will be made.`
        );
      }
    });
  }

}


function addSectionHeading(text) {
  const heading = document.createElement("h3");
  heading.textContent = text;
  report.appendChild(heading);
}


function addResult(type, text) {
  const item = document.createElement("div");
  item.className = `result ${type}`;

  let prefix = "";

  if (type === "pass") {
    prefix = "✓ ";
  } else if (type === "fail") {
    prefix = "✕ ";
  } else {
    prefix = "⚠ ";
  }

  item.textContent = prefix + text;
  report.appendChild(item);
}


function addDetail(text) {
  const detail = document.createElement("div");
  detail.className = "detail";
  detail.textContent = text;
  report.appendChild(detail);
}


function showMessage(message) {
  report.textContent = "";

  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  report.appendChild(paragraph);
}


/* =========================================================
   CREATE ACCESSIBLE COPY
   ========================================================= */

fixButton.addEventListener("click", async () => {
  if (!currentProjectFile) {
    alert("Please check a project first.");
    return;
  }

  if (!mainDocumentSelect.value) {
    alert("Please select the main LaTeX document.");
    return;
  }

  const originalButtonText = fixButton.textContent;

  fixButton.disabled = true;
  fixButton.textContent = "Creating Accessible Copy...";

  try {
    const outputZip = await JSZip.loadAsync(currentProjectFile);

    const rootFilename = normalizeProjectPath(
      mainDocumentSelect.value
    );

    const projectScope = buildDependencyGraph(
      rootFilename,
      currentLatexFiles
    );

    const filesToFix = projectScope.usedFiles;
    const changes = [];

    const packageCompatibility =
      analyzePackageCompatibility(
        currentLatexFiles,
        projectScope
      );

    const removeUnusedSysteme =
      packageCompatibility.some(item =>
        item.packageName === "systeme" &&
        item.autoRemove
      );

    for (const [rawFilename, zipEntry] of Object.entries(outputZip.files)) {
      if (zipEntry.dir) {
        continue;
      }

      const filename = normalizeProjectPath(rawFilename);
      const lowerName = filename.toLowerCase();

      if (
        !lowerName.endsWith(".tex") &&
        !lowerName.endsWith(".sty") &&
        !lowerName.endsWith(".cls")
      ) {
        continue;
      }

      // Only modify files that belong to the selected document.
      if (!filesToFix.has(filename)) {
        continue;
      }

      let source = await zipEntry.async("string");
      const originalSource = source;

      // Only the selected main document receives \DocumentMetadata.
      if (filename === rootFilename) {
        const metadataResult =
          ensureAccessibleDocumentMetadata(source);

        source = metadataResult.source;

        metadataResult.changes.forEach(change => {
          changes.push(`${filename}: ${change}`);
        });
      }

      // Remove settings that explicitly disable LuaMML
      // from files used by the selected document.
      const luammlResult =
        removeLuaMMLDisablingSettings(source);

      source = luammlResult.source;

      luammlResult.changes.forEach(change => {
        changes.push(`${filename}: ${change}`);
      });

      // systeme is currently incompatible with LuaMML. If the package
      // is loaded but no \systeme command is used anywhere in the
      // selected project scope, remove the package declaration safely.
      if (removeUnusedSysteme) {
        const packageRemovalResult =
          removePackageFromSource(source, "systeme");

        source = packageRemovalResult.source;

        packageRemovalResult.changes.forEach(change => {
          changes.push(`${filename}: ${change}`);
        });
      }

      if (source !== originalSource) {
        outputZip.file(rawFilename, source);
      }
    }

    const reportText = buildAccessibilityChangesReport(
      rootFilename,
      changes,
      projectScope,
      packageCompatibility
    );

    outputZip.file(
      "ACCESSIBILITY_CHANGES.txt",
      reportText
    );

    const blob = await outputZip.generateAsync({
      type: "blob"
    });

    const outputName =
      createAccessibleFilename(currentProjectFile.name);

    downloadBlob(blob, outputName);

    addSectionHeading("Accessible copy");

    addResult(
      "pass",
      `Created ${outputName}.`
    );

    addDetail(
      "Your original ZIP was not changed."
    );

  } catch (error) {
    console.error(error);

    alert(
      "The accessible copy could not be created. See the browser console for details."
    );

  } finally {
    fixButton.disabled =
      currentRootDocuments.length === 0;

    fixButton.textContent =
      originalButtonText;
  }
});


/* =========================================================
   ACCESSIBILITY METADATA FIXER
   ========================================================= */

function ensureAccessibleDocumentMetadata(source) {
  const changes = [];

  const metadataRange =
    findDocumentMetadata(source);

  const documentClassMatch =
    source.match(/\\documentclass(?:\s*\[[^\]]*\])?\s*\{/);

  if (!documentClassMatch) {
    return {
      source,
      changes
    };
  }

  const documentClassIndex =
    documentClassMatch.index;

  // CASE 1: No \DocumentMetadata exists.
  if (!metadataRange) {
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
      source.slice(0, documentClassIndex) +
      metadata +
      source.slice(documentClassIndex);

    changes.push(
      "Added accessible \\DocumentMetadata before \\documentclass."
    );

    return {
      source,
      changes
    };
  }

  // CASE 2: Metadata already exists.
  const metadataContent =
    source.slice(
      metadataRange.contentStart,
      metadataRange.contentEnd
    );

  let entries =
    splitTopLevelCommaList(metadataContent);

  entries = setMetadataEntry(
    entries,
    "lang",
    "en-US"
  );

  entries = setMetadataEntry(
    entries,
    "pdfversion",
    "2.0"
  );

  entries = setMetadataEntry(
    entries,
    "pdfstandard",
    "ua-2"
  );

  entries = setMetadataEntry(
    entries,
    "tagging",
    "on"
  );

  entries = ensureMathMLTaggingSetup(entries);

  const newMetadata =
`\\DocumentMetadata{
  ${entries
    .map(entry => entry.trim())
    .filter(Boolean)
    .join(",\n  ")}
}`;

  source =
    source.slice(0, metadataRange.start) +
    newMetadata +
    source.slice(metadataRange.end);

  changes.push(
    "Updated \\DocumentMetadata for PDF/UA-2 tagging and MathML-SE."
  );

  return {
    source,
    changes
  };
}


function findDocumentMetadata(source) {
  const command = "\\DocumentMetadata";
  const position = source.indexOf(command);

  if (position === -1) {
    return null;
  }

  let openBrace = position + command.length;

  while (
    openBrace < source.length &&
    /\s/.test(source[openBrace])
  ) {
    openBrace++;
  }

  if (source[openBrace] !== "{") {
    return null;
  }

  let depth = 0;

  for (
    let i = openBrace;
    i < source.length;
    i++
  ) {
    const char = source[i];

    if (
      char === "{" &&
      !isCharacterEscaped(source, i)
    ) {
      depth++;
    }

    if (
      char === "}" &&
      !isCharacterEscaped(source, i)
    ) {
      depth--;

      if (depth === 0) {
        return {
          start: position,
          end: i + 1,
          contentStart: openBrace + 1,
          contentEnd: i
        };
      }
    }
  }

  return null;
}


function isCharacterEscaped(text, position) {
  let backslashes = 0;

  for (
    let i = position - 1;
    i >= 0 && text[i] === "\\";
    i--
  ) {
    backslashes++;
  }

  return backslashes % 2 === 1;
}


function splitTopLevelCommaList(text) {
  const entries = [];
  let current = "";

  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let inComment = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inComment) {
      current += char;

      if (char === "\n") {
        inComment = false;
      }

      continue;
    }

    if (
      char === "%" &&
      !isCharacterEscaped(text, i)
    ) {
      inComment = true;
      current += char;
      continue;
    }

    if (
      char === "{" &&
      !isCharacterEscaped(text, i)
    ) {
      braceDepth++;
    }

    if (
      char === "}" &&
      !isCharacterEscaped(text, i)
    ) {
      braceDepth--;
    }

    if (
      char === "[" &&
      !isCharacterEscaped(text, i)
    ) {
      bracketDepth++;
    }

    if (
      char === "]" &&
      !isCharacterEscaped(text, i)
    ) {
      bracketDepth--;
    }

    if (
      char === "(" &&
      !isCharacterEscaped(text, i)
    ) {
      parenthesisDepth++;
    }

    if (
      char === ")" &&
      !isCharacterEscaped(text, i)
    ) {
      parenthesisDepth--;
    }

    if (
      char === "," &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenthesisDepth === 0
    ) {
      entries.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    entries.push(current);
  }

  return entries;
}


function setMetadataEntry(
  entries,
  key,
  value
) {
  const escapedKey = key.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  const pattern = new RegExp(
    "^\\s*" +
    escapedKey +
    "\\s*="
  );

  let replaced = false;
  const result = [];

  for (const entry of entries) {
    if (pattern.test(entry.trim())) {
      if (!replaced) {
        result.push(`${key}=${value}`);
        replaced = true;
      }

      continue;
    }

    result.push(entry);
  }

  if (!replaced) {
    result.push(`${key}=${value}`);
  }

  return result;
}


function ensureMathMLTaggingSetup(entries) {
  const pattern =
    /^\s*tagging-setup\s*=/;

  const index = entries.findIndex(entry =>
    pattern.test(entry.trim())
  );

  if (index === -1) {
    entries.push(
      "tagging-setup={math/setup=mathml-SE}"
    );

    return entries;
  }

  const entry = entries[index].trim();
  const equalsPosition = entry.indexOf("=");

  let value =
    entry.slice(equalsPosition + 1).trim();

  if (
    value.startsWith("{") &&
    value.endsWith("}")
  ) {
    value = value.slice(1, -1);
  }

  let setupEntries =
    splitTopLevelCommaList(value);

  setupEntries = setMetadataEntry(
    setupEntries,
    "math/setup",
    "mathml-SE"
  );

  entries[index] =
    `tagging-setup={${setupEntries
      .map(item => item.trim())
      .filter(Boolean)
      .join(", ")}}`;

  return entries;
}


/* =========================================================
   LUAMML FIXER
   ========================================================= */

function removeLuaMMLDisablingSettings(source) {
  const changes = [];

  const conditionalPattern =
    /\\IfPackageAtLeastTF\s*\{tagpdf\}\s*\{[^}]*\}\s*\{\s*\\tagpdfsetup\s*\{\s*math\s*\/\s*mathml\s*\/\s*luamml\s*\/\s*load\s*=\s*false\s*\}\s*\}\s*\{\s*\}/gs;

  if (conditionalPattern.test(source)) {
    source = source.replace(
      conditionalPattern,
      ""
    );

    changes.push(
      "Removed conditional setting that disabled LuaMML."
    );
  }

  const directPattern =
    /\\tagpdfsetup\s*\{\s*math\s*\/\s*mathml\s*\/\s*luamml\s*\/\s*load\s*=\s*false\s*\}/gs;

  if (directPattern.test(source)) {
    source = source.replace(
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
  packageCompatibility = []
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

  if (changes.length === 0) {
    text +=
`No source changes were necessary.
`;
  } else {
    changes.forEach(change => {
      text += `- ${change}\n`;
    });
  }

  if (projectScope.missing.length > 0) {
    text +=
`
Warnings
--------
`;

    projectScope.missing.forEach(item => {
      text +=
        `- Missing reference: ${item.from} -> ${item.target}\n`;
    });
  }

  if (projectScope.dynamic.length > 0) {
    if (projectScope.missing.length === 0) {
      text +=
`
Warnings
--------
`;
    }

    projectScope.dynamic.forEach(item => {
      text +=
        `- Dynamic reference requires review: ${item.from} -> ${item.target}\n`;
    });
  }

  if (packageCompatibility.length > 0) {
    text +=
`
Package compatibility review
----------------------------
`;

    packageCompatibility.forEach(item => {
      if (item.packageName === "systeme" && item.autoRemove) {
        text +=
          `- systeme: loaded but no systeme-specific command usage detected; package declaration removed automatically.\n`;
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


function createAccessibleFilename(filename) {
  const base =
    filename.replace(/\.zip$/i, "");

  return `${base}_Accessible.zip`;
}


function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}
