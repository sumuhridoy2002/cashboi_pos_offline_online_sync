/**
 * Project      : Cashboi POS (Offline + Online Sync)
 * Description  : This application allows users to make sales offline
 *                using local storage / indexedDB. When internet
 *                becomes available again, all pending invoices,
 *                customers, and inventory updates get synced automatically
 *                to the main online server.
 *
 * Key Features :
 *   ✔ Offline POS Sale Processing
 *   ✔ Auto Sync When Online
 *   ✔ Customer & Product Cache
 *   ✔ Background Queue System
 *   ✔ Fallback UI for No-Internet Scenarios
 *
 * Technology   : HTML, CSS, JavaScript, IndexedDB / LocalStorage,
 *                REST API, CodeIgniter backend
 *
 * Author       : Ali Azgor Hridoy
 * GitHub       : https://github.com/sumuhridoy2002
 * Repository   : https://github.com/sumuhridoy2002/cashboi_pos_offline_online_sync
 * Version      : 1.0.0
 * License      : MIT
 *
 * Note         : Please keep author credits and GitHub link
 *                if you reuse or redistribute this source code.
 */
$(document).ready(function () {
    document.addEventListener("contextmenu", e => e.preventDefault())
    document.onkeydown = (e) => {
        if (e.key === "F12") e.preventDefault()
        if (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "C" || e.key === "J")) e.preventDefault()
        if (e.ctrlKey && e.key === "U") e.preventDefault()
    }

    $(".select2").select2()

    const token = localStorage.getItem("cashboi_token")
    const user = localStorage.getItem("cashboi_user")
    let db

    // --- Database Setup ---
    const request = indexedDB.open("CashboiOfflineDB", 3)
    request.onupgradeneeded = e => {
        let dbObj = e.target.result
        if (!dbObj.objectStoreNames.contains("sales")) dbObj.createObjectStore("sales", { keyPath: "id", autoIncrement: true })
        if (!dbObj.objectStoreNames.contains("online_sales")) dbObj.createObjectStore("online_sales", { keyPath: "saleID" })
        if (!dbObj.objectStoreNames.contains("customers")) dbObj.createObjectStore("customers", { keyPath: "customerID" })
        if (!dbObj.objectStoreNames.contains("products")) dbObj.createObjectStore("products", { keyPath: "productID" })
        if (!dbObj.objectStoreNames.contains("accounts")) dbObj.createObjectStore("accounts", { keyPath: "uid", autoIncrement: true })
    }

    request.onsuccess = e => {
        db = e.target.result
        if (!token) window.location.href = "login.html"
        else { $("#app").show(); renderSelectsFromDB(); refreshSyncStatus(); }
    };

    // --- Master Data Download ---
    $('#downloadMasterData').click(async function () {
        $('#syncOverlay').show()
        $('#syncText').text("Downloading Master Data...")
        try {
            const [cust, prod, cash, bank, mob, sales] = await Promise.all([
                fetch("https://www.cashboi.com.bd/api/Customer/customers", { headers: { Authorization: "Bearer " + token } }).then(r => r.json()),
                fetch("https://www.cashboi.com.bd/api/Product/products", { headers: { Authorization: "Bearer " + token } }).then(r => r.json()),
                fetch("https://www.cashboi.com.bd/api/CashAccount/cashaccount", { headers: { Authorization: "Bearer " + token } }).then(r => r.json()),
                fetch("https://www.cashboi.com.bd/api/BankAccount/bankaccount", { headers: { Authorization: "Bearer " + token } }).then(r => r.json()),
                fetch("https://www.cashboi.com.bd/api/MobileAccount/mobileaccount", { headers: { Authorization: "Bearer " + token } }).then(r => r.json()),
                fetch("https://www.cashboi.com.bd/api/Sale/sales", { headers: { Authorization: "Bearer " + token } }).then(r => r.json())
            ])

            const tx = db.transaction(["customers", "products", "accounts", "online_sales"], "readwrite")
            tx.objectStore("customers").clear()
            tx.objectStore("products").clear()
            tx.objectStore("accounts").clear()
            tx.objectStore("online_sales").clear()

            cust.data.forEach(c => { c.customerID = parseInt(c.customerID); tx.objectStore("customers").add(c); })
            prod.data.forEach(p => { p.productID = parseInt(p.productID); tx.objectStore("products").add(p); })
            sales.data.forEach(s => { s.saleID = parseInt(s.saleID); tx.objectStore("online_sales").add(s); })

            cash.data.forEach(a => tx.objectStore("accounts").add({ ...a, type: 'Cash', label: a.cashName, id: a.ca_id }))
            bank.data.forEach(a => tx.objectStore("accounts").add({ ...a, type: 'Bank', label: `${a.bankName} ${a.branchName} ${a.accountName}`, id: a.ba_id }))
            mob.data.forEach(a => tx.objectStore("accounts").add({ ...a, type: 'Mobile', label: `${a.accountName} (${a.accountNo})`, id: a.ma_id }))

            tx.oncomplete = () => {
                $('#syncOverlay').hide()
                Swal.fire("Success", "Offline Data Updated!", "success").then(() => location.reload())
            }
        } catch (e) { alert("Download failed."); $('#syncOverlay').hide(); }
    })

    // --- Render Data from indexedDB ---
    async function renderSelectsFromDB() {
        const tx = db.transaction(["customers", "products", "accounts"], "readonly")

        tx.objectStore("customers").getAll().onsuccess = e => {
            $('#customerID').empty().append(new Option("Select Customer", ""))
            e.target.result.forEach(c => $('#customerID').append(new Option(`${c.customerName} (${c.mobile})`, c.customerID)))
        }

        tx.objectStore("products").getAll().onsuccess = e => {
            $('#productID').empty().append(new Option("Select Product", ""))
            e.target.result.forEach(p => $('#productID').append(new Option(`${p.productName} - Stock: ${p.stock_quantity}`, p.productID)))
        }

        updateAccountUI()
    }

    function updateAccountUI() {
        const type = $('#accountType').val()
        db.transaction("accounts", "readonly").objectStore("accounts").getAll().onsuccess = e => {
            const dropdown = $('#accountNo').empty()
            e.target.result.filter(a => a.type === type).forEach(a => dropdown.append(new Option(a.label, a.id)))
        }
    }
    $('#accountType').on('change', updateAccountUI)

    // --- POS Logic ---
    $(document).on('change', '#productID', function () {
        const pid = $(this).val()
        if (!pid) return

        const tx = db.transaction("products", "readonly")
        tx.objectStore("products").get(parseInt(pid)).onsuccess = e => {
            const p = e.target.result
            if (!p) return

            if ($(`#qty_${p.productID}`).length) return

            $('#tbody').append(`<tr>
                        <td class="first_td">${p.productName} <input type="hidden" name="pname" value="${p.productName}"><input type="hidden" name="pid" value="${p.productID}"></td>
                        <td><span class="badge badge-info">${p.stock_quantity || 0}</span></td>
                        <td><input type="number" class="form-control" onkeyup="updateRow(${p.productID})" id="qty_${p.productID}" value="1"></td>
                        <td><input type="number" class="form-control" onkeyup="updateRow(${p.productID})" id="rate_${p.productID}" value="${p.sprice}"></td>
                        <td><input type="text" class="form-control rowTotal" id="total_${p.productID}" value="${p.sprice}" readonly></td>
                        <td><button type="button" class="btn btn-danger btn-sm" onclick="$(this).closest('tr').remove(); calculateTotal();">×</button></td>
                    </tr>`)
            calculateTotal()
        }
    })

    window.updateRow = id => {
        const q = parseFloat($(`#qty_${id}`).val()) || 0
        const r = parseFloat($(`#rate_${id}`).val()) || 0
        $(`#total_${id}`).val((q * r).toFixed(2))
        calculateTotal()
    }

    window.calculateTotal = () => {
        let sub = 0; $('.rowTotal').each(function () { sub += parseFloat($(this).val()) || 0; })
        let ship = parseFloat($('#sCost').val()) || 0, vat = parseFloat($('#vCost').val()) || 0, disc = parseFloat($('#discount').val()) || 0, paid = parseFloat($('#totalprice').val()) || 0
        let grand = (sub + ship + (sub * vat / 100)) - disc
        $('#nAmount').val(grand.toFixed(2))
        $('#dAmount').val((grand - paid).toFixed(2))
    }
    $('.calc-trigger').on('keyup change', calculateTotal)

    // --- Save & Print ---
    $('#posForm').submit(function (e) {
        e.preventDefault()
        let products = [], printRows = ""

        $('#tbody tr').each(function () {
            const pid = $(this).find('input[name="pid"]').val()
            const name = $(this).find('input[name="pname"]').val()
            const qty = $(`#qty_${pid}`).val()
            const total = $(`#total_${pid}`).val()
            products.push({ product: pid, quantity: qty, uprice: $(`#rate_${pid}`).val(), tprice: total })
            printRows += `<tr><td>${name}</td><td>${qty}</td><td style="text-align:right;">${total}</td></tr>`
        })

        if (products.length === 0) return alert("Add products first")

        const saleData = {
            sale: {
                saDate: new Date().toISOString().split('T')[0],
                customer: $('#customerID').val(),
                tAmount: $('#nAmount').val(),
                pAmount: $('#totalprice').val(),
                dAmount: $('#dAmount').val(),
                acType: $('#accountType').val(),
                acNo: $('#accountNo').val(),
                note: "Offline",
                compid: JSON.parse(user).compid,
                regby: JSON.parse(user).uid,
                compname: JSON.parse(user).compname
            },
            products: products
        }

        // Set Data for Print
        $('#pDate').text(new Date().toLocaleString())
        $('#pCustomer').text($("#customerID option:selected").text())
        $('#pItems').html(printRows)
        $('#pTotals').html(`Total: ${$('#nAmount').val()}<br>Paid: ${$('#totalprice').val()}<br>Due: ${$('#dAmount').val()}`)

        // Save Data into indexedDB
        const transaction = db.transaction("sales", "readwrite")
        transaction.objectStore("sales").add(saleData)

        transaction.oncomplete = () => {
            window.print()

            window.onafterprint = function () {
                location.reload()
            }

            // As backup: if onafterprint does not work then it will reload after 2s
            setTimeout(function () {
                location.reload()
            }, 2000)
        }
    })

    // --- Sync ---
    $('#syncSalesBtn').click(async function () {
        $('#syncOverlay').show()
        const sales = await new Promise(res => db.transaction("sales").objectStore("sales").getAll().onsuccess = e => res(e.target.result))
        for (let s of sales) {
            try {
                const res = await fetch("https://www.cashboi.com.bd/api/Sale/save_sale", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
                    body: JSON.stringify({ sale: s.sale, products: s.products, })
                })
                if (res.ok) db.transaction("sales", "readwrite").objectStore("sales").delete(s.id)
            } catch (e) { }
        }
        $('#syncOverlay').hide()
        refreshSyncStatus()
        Swal.fire("Success", "All Sales Synced!", "success")
    })

    function refreshSyncStatus() {
        db.transaction("sales").objectStore("sales").count().onsuccess = e => {
            if (e.target.result > 0) { $('#pendingCount').text(e.target.result); $('#syncSalesBtn').show(); } else { $('#syncSalesBtn').hide(); }
        }
    }

    // --- Customers ---
    $('#customerBtn').click(function () {

        $('#dataModalTitle').text('Customers')

        $('#dataTable thead').html(`
            <tr>
                <th colspan="4">
                    <form id="addCustomerForm" class="p-2 bg-light border rounded mb-2">
                        <div class="row g-2">
                            <div class="col-md-3">
                                <input class="form-control" id="custName" placeholder="Customer Name *" required>
                            </div>
                            <div class="col-md-2">
                                <input class="form-control" id="custMobile" placeholder="Mobile *" required>
                            </div>
                            <div class="col-md-2">
                                <input class="form-control" id="custEmail" placeholder="Email">
                            </div>
                            <div class="col-md-3">
                                <input class="form-control" id="custAddress" placeholder="Address">
                            </div>
                            <div class="col-md-2">
                                <button class="btn btn-success w-100">Add Customer</button>
                            </div>
                        </div>
                    </form>
                </th>
            </tr>
            <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Mobile</th>
                <th>Address</th>
            </tr>
        `)

        const tbody = $('#dataTable tbody').empty()

        // load from indexedDB
        const tx = db.transaction("customers", "readonly")
        tx.objectStore("customers").getAll().onsuccess = e => {
            e.target.result.forEach(c => {
                tbody.append(`
                    <tr>
                        <td>${c.customerID}</td>
                        <td>${c.customerName}</td>
                        <td>${c.mobile}</td>
                        <td>${c.address || ''}</td>
                    </tr>
                `)
            })
        }

        $('#dataModal').modal('show')
    })

    $(document).on('submit', '#addCustomerForm', async function (e) {
        e.preventDefault()

        if (!navigator.onLine) {
            Swal.fire({
                icon: "warning",
                title: "Offline Mode",
                text: "You are offline. Please connect to internet to add customer.",
                confirmButtonText: "OK"
            })
            return
        }

        if (!user) {
            Swal.fire("Error", "User not found. Please login again.", "error")
            return
        }

        const payload = {
            custName: $('#custName').val(),
            custCompany: $('#custCompany').val() || "",
            custMobile: $('#custMobile').val(),
            custEmail: $('#custEmail').val() || "",
            custAddress: $('#custAddress').val() || "",
            opbalance: "0",
            compid: JSON.parse(user).compid,
            regby: JSON.parse(user).uid,
            compname: JSON.parse(user).compname
        }

        try {
            $('#syncOverlay').show()
            $('#syncText').text("Saving Customer...")

            const res = await fetch("https://cashboi.com.bd/api/Customer/save_customer", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token
                },
                body: JSON.stringify(payload)
            })

            const data = await res.json()

            if (!res.ok) throw new Error(data.message || "Save failed")

            // 👉 Save into IndexedDB (offline cache)
            const tx = db.transaction("customers", "readwrite")
            tx.objectStore("customers").add({
                customerID: parseInt(data.data.customerID || Date.now()),
                customerName: payload.custName,
                mobile: payload.custMobile,
                address: payload.custAddress
            })

            tx.oncomplete = () => {
                $('#syncOverlay').hide()
                Swal.fire("Success", "Customer Added!", "success")

                $('#addCustomerForm')[0].reset()
                renderSelectsFromDB()
                $('#customerID').val(data.data.customerID).trigger('change')
                $('#customerBtn').click()
            }

        } catch (err) {
            $('#syncOverlay').hide()
            Swal.fire("Error", err.message || "Customer save failed", "error")
        }
    })

    // --- Sales ---
    $('#salesBtn').click(function () {

        $('#dataModalTitle').text('Sales List')

        $('#dataTable thead').html(`
            <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Due</th>
                <th>Status</th>
            </tr>
        `)

        const tbody = $('#dataTable tbody').empty()

        $('#syncOverlay').show()

        const tx = db.transaction(["online_sales", "sales"], "readonly")

        const onlineReq = tx.objectStore("online_sales").getAll()
        const offlineReq = tx.objectStore("sales").getAll()

        Promise.all([
            new Promise(r => onlineReq.onsuccess = e => r(e.target.result)),
            new Promise(r => offlineReq.onsuccess = e => r(e.target.result))
        ]).then(([online, offline]) => {

            // Online rows
            online.forEach(s => {
                tbody.append(`
                    <tr>
                        <td>${s.invoice_no}</td>
                        <td>${s.saleDate}</td>
                        <td>${s.customerName}</td>
                        <td>${Number(s.totalAmount).toLocaleString()}</td>
                        <td>${Number(s.pAmount).toLocaleString()}</td>
                        <td class="text-danger">${Number(s.dueamount).toLocaleString()}</td>
                        <td><span class="badge bg-success">Online</span></td>
                    </tr>
                `)
            })

            // Offline rows
            offline.forEach(s => {
                tbody.append(`
                    <tr class="table-warning">
                        <td>Pending</td>
                        <td>${s.sale.saDate}</td>
                        <td>-</td>
                        <td>${s.sale.tAmount}</td>
                        <td>${s.sale.pAmount}</td>
                        <td>${s.sale.dAmount}</td>
                        <td><span class="badge bg-danger">Offline</span></td>
                    </tr>
                `)
            })

            $('#syncOverlay').hide()
            $('#dataModal').modal('show')
        })
    })

    // --- Products/Stock ---
    $('#stockBtn').click(function () {
        $('#dataModalTitle').text('Stock / Products')
        $('#dataTable thead').html(`
            <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Stock</th>
                <th>Price</th>
            </tr>
        `)

        const tbody = $('#dataTable tbody').empty()

        const tx = db.transaction("products", "readonly")
        tx.objectStore("products").getAll().onsuccess = e => {
            e.target.result.forEach(p => {
                tbody.append(`
                    <tr>
                        <td>${p.productcode}</td>
                        <td>${p.productName}</td>
                        <td>${p.categoryName}</td>
                        <td><span class="badge bg-info">${p.stock_quantity}</span></td>
                        <td>${p.sprice ? Number(p.sprice).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '0.00'} BDT</td>
                    </tr>
                `)
            })
        }

        $('#dataModal').modal('show')
    })

    if(user) document.getElementById("storeName").innerText = JSON.parse(user).compname
    
    function updateDateTime(){
        const now = new Date()
        const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]
        const dayName = days[now.getDay()]
        const inputDate = now.toLocaleDateString('en-CA')
        const displayDate = now.toLocaleDateString('en-GB')
        const time = now.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        })

        $('#date').val(inputDate)
        document.getElementById("dayName").innerText = dayName
        document.getElementById("dateTime").innerText = `${displayDate} | ${time}`
    }

    setInterval(updateDateTime, 1000)
    updateDateTime()
})