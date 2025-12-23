fetch('./resources/data/lusterlist.json')
  .then(res => res.json())
  .then(items => {
    const container = document.getElementById('product');
    container.innerHTML = '';

    const rowDiv = document.createElement('div');
    rowDiv.className = "row g-4";

    items.forEach((item) => {
      const colDiv = document.createElement('div');
      colDiv.className = "col-lg-4 col-md-6 col-12";

      const card = document.createElement('div');
      card.className = "card shadow-sm h-100 text-center p-3";

      // Image
      const img = document.createElement('img');
      img.src = item.image_file;
      img.alt = item.colour_name;
      img.className = "card-img-top img-fluid mb-3";
      img.style.maxHeight = "180px";
      img.style.objectFit = "contain";

      // Name
      const title = document.createElement('h5');
      title.className = "card-title fw-semibold mb-2";
      title.textContent = item.colour_name;

      // Description
      const desc = document.createElement('p');
      desc.className = "text-muted small mb-2";
      desc.textContent = item.description;

      // Row for color patch + code
      const codeRow = document.createElement('div');
      codeRow.className = "d-flex justify-content-center align-items-center gap-2 mb-3";

      // Color patch
      const patch = document.createElement('div');
      patch.style.width = "40px";
      patch.style.height = "20px";
      patch.style.backgroundColor = item.hex_value;
      patch.style.border = "1px solid #555";
      patch.style.borderRadius = "4px";

      // Color Code
      const code = document.createElement('span');
      code.className = "fw-bold";
      code.style.fontSize = "1rem";
      code.textContent = item.color_code;

      codeRow.appendChild(patch);
      codeRow.appendChild(code);

      // Stock badge
      const stock = document.createElement('span');
      stock.className = "badge bg-success";
      stock.textContent = item.stock_level;

      card.appendChild(img);
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(codeRow);
      card.appendChild(stock);

      colDiv.appendChild(card);
      rowDiv.appendChild(colDiv);
    });

    container.appendChild(rowDiv);
  });
