const checkButton = document.getElementById("checkButton");
const fixButton = document.getElementById("fixButton");
const zipFile = document.getElementById("zipFile");
const report = document.getElementById("report");

let currentProjectFile = null;
let currentRootDocuments = [];
currentRootDocuments
checkButton.addEventListener("click", async () => {
  if (!zipFile.files.length) {
    showMessage("Please choose a ZIP file first.");
    return;
  }

  const file = zipFile.files[0];
  currentProjectFile = file;
currentRootDocuments = [];
fixButton.disabled = true;

  showMessage(`Reading ${file.name}...`);

  try {
    const zip = await JSZip.loadAsync(file);

    const latexFiles = [];

    for (const [filename, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue;

      // Ignore common operating-system metadata files
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
          filename,
          rawContent,
          content: stripLatexComments(rawContent)
        });
      }
    }

    analyzeProject(file.name, latexFiles);

  } catch (error) {
    console.error(error);

    showMessage(
      "The ZIP file could not be read. Please make sure it is a valid LaTeX or Overleaf project ZIP."
    );
  }
});


function analyzeProject(projectName, files) {
  if (files.length === 0) {
    showMessage(
      "No .tex, .sty, or .cls files were found in this ZIP."
    );
    return;
  }

  // Find files containing \documentclass.
  // These are candidate root/main documents.
  const rootDocuments = files.filter(file =>
    /\\documentclass(?:\s*\[[^\]]*\])?\s*\{/.test(file.content)
  );

currentRootDocuments =
  rootDocuments.map(file => file.filename);

updateMainDocumentSelector();
  function updateMainDocumentSelector() {

  mainDocumentSelect.innerHTML = "";

  if (currentRootDocuments.length === 0) {
    mainDocumentArea.hidden = true;
    fixButton.disabled = true;
    return;
  }

  currentRootDocuments.forEach(filename => {

    const option =
      document.createElement("option");

    option.value = filename;
    option.textContent = filename;

    mainDocumentSelect.appendChild(option);
  });

  // Prefer main.tex automatically when it exists.
  const preferredMain =
    currentRootDocuments.find(filename =>
      filename.toLowerCase() === "main.tex"
    );

  if (preferredMain) {
    mainDocumentSelect.value = preferredMain;
  }

  mainDocumentArea.hidden = false;
  fixButton.disabled = false;
}

  // Search the entire project for important accessibility settings.
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

  renderReport({
    projectName,
    files,
    rootDocuments,
    metadataFiles,
    mathMLFiles,
    luaMMLDisabledFiles,
    metadataResults
  });
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

  // Skip whitespace
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

      // Do not include the outermost brace
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

        // Count consecutive backslashes immediately before %
        let backslashes = 0;

        for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) {
          backslashes++;
        }

        // An even number means % is not escaped.
        if (backslashes % 2 === 0) {
          return line.substring(0, i);
        }
      }

      return line;
    })
    .join("\n");
}


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


  // DOCUMENT METADATA
  addSectionHeading("Document metadata");

  if (data.metadataResults.length === 0) {
    addResult(
      "warning",
      "No candidate main document was available for metadata inspection."
    );
  }

  data.metadataResults.forEach(result => {
    const heading = document.createElement("h4");
    heading.textContent = result.filename;
    report.appendChild(heading);

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
  });


  // PROJECT-WIDE MATHML
  addSectionHeading("Math accessibility");

  if (data.mathMLFiles.length > 0) {
    addResult(
      "pass",
      "math/setup=mathml-SE was detected in the project."
    );

    data.mathMLFiles.forEach(file => {
      addDetail(file.filename);
    });
  } else {
    addResult(
      "fail",
      "math/setup=mathml-SE was not detected anywhere in the project."
    );
  }


  // LUAMML DISABLING
  addSectionHeading("LuaMML compatibility");

  if (data.luaMMLDisabledFiles.length === 0) {
    addResult(
      "pass",
      "No setting that explicitly disables LuaMML was detected."
    );
  } else {
    addResult(
      "fail",
      "LuaMML is explicitly disabled. This prevents MathML from being generated."
    );

    data.luaMMLDisabledFiles.forEach(file => {
      addDetail(
        `${file.filename} contains math/mathml/luamml/load=false`
      );
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

    // Re-open the ORIGINAL uploaded ZIP.
    // This means we never modify the user's original project.
    const outputZip = await JSZip.loadAsync(currentProjectFile);

    const rootFilename =
  mainDocumentSelect.value;

    const changes = [];

    for (const [filename, zipEntry] of Object.entries(outputZip.files)) {

      if (zipEntry.dir) {
        continue;
      }

      const lowerName = filename.toLowerCase();

      if (
        !lowerName.endsWith(".tex") &&
        !lowerName.endsWith(".sty") &&
        !lowerName.endsWith(".cls")
      ) {
        continue;
      }

      let source = await zipEntry.async("string");
      const originalSource = source;

      // Only the main document receives \DocumentMetadata.
      if (filename === rootFilename) {

        const metadataResult =
          ensureAccessibleDocumentMetadata(source);

        source = metadataResult.source;

        metadataResult.changes.forEach(change => {
          changes.push(`${filename}: ${change}`);
        });
      }

      // Search ALL LaTeX source/configuration files
      // for settings that explicitly disable LuaMML.
      const luammlResult =
        removeLuaMMLDisablingSettings(source);

      source = luammlResult.source;

      luammlResult.changes.forEach(change => {
        changes.push(`${filename}: ${change}`);
      });

      if (source !== originalSource) {
        outputZip.file(filename, source);
      }
    }


    // Add a human-readable report to the ZIP.
    const reportText = buildAccessibilityChangesReport(
      rootFilename,
      changes
    );

    outputZip.file(
      "ACCESSIBILITY_CHANGES.txt",
      reportText
    );


    // Generate the new ZIP entirely in the browser.
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


  // CASE 1:
  // No \DocumentMetadata exists.
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


  // CASE 2:
  // Metadata already exists.
  let metadataContent =
    source.slice(
      metadataRange.contentStart,
      metadataRange.contentEnd
    );

  let entries =
    splitTopLevelCommaList(metadataContent);


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
    ensureMathMLTaggingSetup(entries);


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

  const position =
    source.indexOf(command);

  if (position === -1) {
    return null;
  }

  let openBrace =
    position + command.length;

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

  for (const entry of entries) {

    if (pattern.test(entry.trim())) {

      if (!replaced) {

        result.push(
          `${key}=${value}`
        );

        replaced = true;
      }

      // Ignore duplicate copies
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

function ensureMathMLTaggingSetup(entries) {

  const pattern =
    /^\s*tagging-setup\s*=/;

  const index =
    entries.findIndex(entry =>
      pattern.test(entry.trim())
    );


  // No tagging-setup exists yet.
  if (index === -1) {

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
    entry.slice(equalsPosition + 1).trim();


  if (
    value.startsWith("{") &&
    value.endsWith("}")
  ) {

    value =
      value.slice(1, -1);
  }


  let setupEntries =
    splitTopLevelCommaList(value);


  setupEntries =
    setMetadataEntry(
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

function removeLuaMMLDisablingSettings(source) {

  const changes = [];


  // Remove the exact helper-style conditional block.
  const conditionalPattern =
    /\\IfPackageAtLeastTF\s*\{tagpdf\}\s*\{[^}]*\}\s*\{\s*\\tagpdfsetup\s*\{\s*math\s*\/\s*mathml\s*\/\s*luamml\s*\/\s*load\s*=\s*false\s*\}\s*\}\s*\{\s*\}/gs;


  if (conditionalPattern.test(source)) {

    source =
      source.replace(
        conditionalPattern,
        ""
      );

    changes.push(
      "Removed conditional setting that disabled LuaMML."
    );
  }


  // Also catch a direct \tagpdfsetup command.
  const directPattern =
    /\\tagpdfsetup\s*\{\s*math\s*\/\s*mathml\s*\/\s*luamml\s*\/\s*load\s*=\s*false\s*\}/gs;


  if (directPattern.test(source)) {

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

function buildAccessibilityChangesReport(
  rootFilename,
  changes
) {

  let text =
`LATEX ACCESSIBILITY PROJECT FIXER
=================================

Main document:
${rootFilename}

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

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);

  link.click();

  link.remove();

  URL.revokeObjectURL(url);
}

